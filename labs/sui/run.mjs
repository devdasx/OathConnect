// Fixed testnet fixture only. Disposable signing keys stay in process memory.
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {SuiGrpcClient} from '@mysten/sui/grpc';
import {Ed25519Keypair} from '@mysten/sui/keypairs/ed25519';
import {getFaucetHost, requestSuiFromFaucetV3} from '@mysten/sui/faucet';
import {Transaction} from '@mysten/sui/transactions';
import {normalizeSuiAddress, normalizeStructTag} from '@mysten/sui/utils';
import {canonical, createIdentity, createPairing, digest, joinPairing} from '@oathconnect/protocol';
import {Session, WalletAuthorizer} from '@oathconnect/sdk';
import {validationRelay} from '../support/relay.mjs';
import {writeEvidence} from '../support/evidence.mjs';

const chain = 'sui:testnet', endpoint = 'https://fullnode.testnet.sui.io:443';
// Pinned from the official Testnet endpoint; a reset requires explicit requalification.
const genesis = '69WiPg3DAQiwdxfncX6wYQ2siKwAe6L9BZthQea3JNMD';
const suiType = normalizeStructTag('0x2::sui::SUI'), framework = normalizeSuiAddress('0x2');
const gasBudget = '10000000';
const client = new SuiGrpcClient({network:'testnet', baseUrl:endpoint});
const started = new Date().toISOString();
let stage = 'network', relay, dapp, wallet, transactionHash, faucetDigest, faucetAmount;
let broadcastAttempted = false, transactionConfirmed = false, decisions = 0, executions = 0;
let adapterFailure;
const safeCode = e => /^fixture_[a-z_]{1,80}$/.test(e?.message) ? e.message : 'provider_or_protocol_failure';
const fail = code => {throw Error('fixture_' + code);};
const signal = () => AbortSignal.timeout(20000);
async function network() {
  if ((await client.getChainIdentifier({signal:signal()})).chainIdentifier !== genesis) fail('network_mismatch');
}
function record(value) {
  writeEvidence('sui-testnet',value);
  console.log(JSON.stringify(value));
}
try {
  await network();
  const sender = new Ed25519Keypair(), recipient = new Ed25519Keypair().toSuiAddress();
  stage = 'free_testnet_funding';
  const funding = await requestSuiFromFaucetV3({host:getFaucetHost('testnet'),recipient:sender.toSuiAddress(),timeout:180000});
  faucetDigest = funding.digest; faucetAmount = funding.amountMist;
  if (funding.status !== 'success' || funding.recipient !== sender.toSuiAddress()) fail('funding_mismatch');
  stage = 'prepare';
  const [{systemState}, {referenceGasPrice}] = await Promise.all([
    client.getCurrentSystemState({signal:signal()}),client.getReferenceGasPrice({signal:signal()})
  ]);
  const epoch = BigInt(systemState.epoch);
  const tx = new Transaction(); tx.setSender(sender.toSuiAddress()); tx.setGasOwner(sender.toSuiAddress());
  tx.setGasPayment([]); tx.setGasBudget(gasBudget); tx.setGasPrice(referenceGasPrice);
  tx.setExpiration({ValidDuring:{minEpoch:String(epoch),maxEpoch:String(epoch+1n),minTimestamp:null,maxTimestamp:null,chain:genesis,nonce:crypto.getRandomValues(new Uint32Array(1))[0]}});
  const [balance] = tx.moveCall({target:'0x2::balance::redeem_funds',typeArguments:[suiType],arguments:[tx.withdrawal({amount:1n,type:suiType})]});
  tx.moveCall({target:'0x2::balance::send_funds',typeArguments:[suiType],arguments:[balance,tx.pure.address(recipient)]});
  const bytes = await tx.build({client}), expected = Buffer.from(bytes).toString('base64');
  transactionHash = await Transaction.from(bytes).getDigest();
  function reviewBytes(encoded) {
    if (encoded !== expected) fail('bytes_changed');
    const d = Transaction.from(Buffer.from(encoded,'base64')).getData();
    if (d.sender !== sender.toSuiAddress() || d.gasData.owner !== d.sender || d.gasData.payment.length !== 0 || String(d.gasData.budget) !== gasBudget || String(d.gasData.price) !== referenceGasPrice) fail('gas_or_sender_mismatch');
    if (d.expiration?.$kind !== 'ValidDuring' || d.expiration.ValidDuring.chain !== genesis || String(d.expiration.ValidDuring.maxEpoch) !== String(epoch+1n)) fail('expiration_mismatch');
    if (d.inputs.length !== 2 || d.commands.length !== 2) fail('commands_mismatch');
    const withdrawal = d.inputs[0].FundsWithdrawal, destination = d.inputs[1].Pure;
    if (!withdrawal || withdrawal.withdrawFrom.$kind !== 'Sender' || withdrawal.typeArg.Balance !== suiType || String(withdrawal.reservation.MaxAmountU64) !== '1' || !destination || Buffer.from(destination.bytes,'base64').toString('hex') !== recipient.slice(2)) fail('inputs_mismatch');
    const redeem = d.commands[0].MoveCall, send = d.commands[1].MoveCall;
    const matches = (c,name) => c && c.package === framework && c.module === 'balance' && c.function === name && c.typeArguments.length === 1 && normalizeStructTag(c.typeArguments[0]) === suiType;
    if (!matches(redeem,'redeem_funds') || !matches(send,'send_funds') || redeem.arguments.length !== 1 || redeem.arguments[0].Input !== 0 || send.arguments.length !== 2 || canonical(send.arguments[0].NestedResult) !== '[0,0]' || send.arguments[1].Input !== 1) fail('commands_mismatch');
  }
  reviewBytes(expected);
  stage = 'simulate';
  const simulation = await client.simulateTransaction({transaction:bytes,include:{balanceChanges:true},signal:signal()});
  if (simulation.$kind !== 'Transaction' || !simulation.Transaction.status.success || !simulation.Transaction.balanceChanges.some(c=>c.address===recipient && normalizeStructTag(c.coinType)===suiType && c.amount==='1')) fail('simulation_mismatch');
  stage = 'pair'; relay = await validationRelay();
  const p = await createPairing(relay.audience), w = await joinPairing(p.uri,relay.audience);
  const dc = relay.client(p.invitation.session,'dapp',await createIdentity()), wc = relay.client(p.invitation.session,'wallet',await createIdentity());
  await dc.create(p.invitation.expires); await wc.join(w.hello);
  dapp = new Session(await p.accept(await dc.hello()),dc,relay.projects); wallet = new Session(w.channel,wc,relay.projects);
  const cap = {chain,account:sender.toSuiAddress(),methods:['sui_signAndExecuteTransaction']};
  await Promise.all([dapp.propose([{chain,methods:cap.methods}]),wallet.approveSession(async()=>[cap])]);
  const authorizer = new WalletAuthorizer([cap],new Map([[chain+'/'+cap.methods[0],{
    async review(request) {
      stage = 'review';
      if (request.chain !== chain || request.account !== sender.toSuiAddress() || canonical(request.params) !== canonical({transaction:expected})) fail('policy_rejected');
      reviewBytes(request.params.transaction);
      return {requestDigest:await digest(canonical(request)),summary:'Send exactly one testnet MIST to a disposable account; maximum gas budget 0.01 testnet SUI.',warnings:['Fixed test fixture; not a general-purpose Sui signer.']};
    },
    async execute(request, context) {
      context.assertActive();
      try {
        stage = 'sign'; if (++executions !== 1) fail('repeated_execution'); reviewBytes(request.params.transaction); await network();
        context.assertActive();const signed = await sender.signTransaction(bytes);
        context.assertActive();stage = 'submit'; broadcastAttempted = true;
        const submitted = await client.executeTransaction({transaction:bytes,signatures:[signed.signature],signal:AbortSignal.any([context.signal,signal()])});
        if (submitted.$kind !== 'Transaction' || !submitted.Transaction.status.success || submitted.Transaction.digest !== transactionHash) fail('submission_unconfirmed');
        stage = 'receipt';
        const result = await client.waitForTransaction({digest:transactionHash,include:{balanceChanges:true,transaction:true},timeout:30000,signal:AbortSignal.timeout(35000)});
        const receipt = result.Transaction;
        if (result.$kind !== 'Transaction' || !receipt.status.success || receipt.digest !== transactionHash || receipt.transaction.sender !== sender.toSuiAddress() || !receipt.balanceChanges.some(c=>c.address===recipient && normalizeStructTag(c.coinType)===suiType && c.amount==='1')) fail('receipt_mismatch');
        transactionConfirmed = true;
        return {hash:transactionHash,checkpoint:receipt.checkpoint};
      } catch(error) {adapterFailure = safeCode(error);throw error;}
    }
  }]]),async(_,review)=>{decisions++;return {approved:true,requestDigest:review.requestDigest};});
  const [result] = await Promise.all([dapp.request(cap,cap.methods[0],{transaction:expected}),wallet.serveOnce(authorizer)]);
  if (decisions !== 1 || executions !== 1 || !transactionConfirmed || result.hash !== transactionHash) fail('result_mismatch');
  record({started,completed:new Date().toISOString(),network:'Sui Testnet',chain,genesis,transport:relay.description,status:'confirmed',transactionConfirmed,...result,decisions,executions,faucetDigest,faucetAmountMist:faucetAmount,operation:'One MIST address-balance transfer; gas budget capped at 10000000 MIST',thorchainSwap:false,harnessSHA256:createHash('sha256').update(readFileSync(new URL(import.meta.url))).digest('hex'),sdkVersion:'@mysten/sui@2.38.0'});
} catch(error) {
  record({started,completed:new Date().toISOString(),network:'Sui Testnet',chain,stage,status:'blocked_or_failed',transactionConfirmed,broadcastAttempted,decisions,executions,...(transactionHash?{hash:transactionHash}:{}),...(faucetDigest?{faucetDigest}:{}),code:adapterFailure??safeCode(error),providerType:/^[A-Za-z0-9_]{1,60}$/.test(error?.constructor?.name)?error.constructor.name:'unknown'});
  process.exitCode = 1;
} finally {
  await dapp?.close().catch(()=>{}); await wallet?.close().catch(()=>{}); await relay?.dispose();
}
