// Sepolia-only qualification. Signing keys stay in this process; no mainnet mode.
import {Wallet, Transaction, toQuantity} from 'ethers';
import {execFileSync} from 'node:child_process';
import {mkdtempSync, writeFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {canonical, createIdentity, createPairing, joinPairing, ProtocolError} from '@oathconnect/protocol';
import {Session, WalletAuthorizer} from '@oathconnect/sdk';
import {EvmAdapter, EvmRpc} from '@oathconnect/evm';
import {validationRelay} from '../support/relay.mjs';
import {writeEvidence} from '../support/evidence.mjs';

const chain='eip155:11155111', genesis='0x25a5cc106eea7138acab33231d7160d69cb777ee0c2c553fcddf5138993e6dd9';
const endpoint='https://gateway.tenderly.co/public/sepolia', rpc=new EvmRpc(endpoint);
const started=new Date().toISOString(), commit=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
const dirty=execFileSync('git',['status','--porcelain'],{encoding:'utf8'}).trim().length>0;
const evidenceName=process.env.OATHCONNECT_LIVE_VALIDATION==='true'?'evm-sepolia-live':'evm-sepolia';
let stage='network', relay, dapp, wallet, authorizer, fundingDirectory, transactionHash;
let decisions=0, executions=0, broadcasts=0;
const bounded=()=>AbortSignal.timeout(15000);
const check=(condition,code)=>{if(!condition)throw new ProtocolError(code);};
async function identity(){
  const [id,first]=await Promise.all([rpc.request('eth_chainId',[],bounded()),rpc.request('eth_getBlockByNumber',['0x0',false],bounded())]);
  check(id==='0xaa36a7'&&first?.hash===genesis&&first?.number==='0x0','evm_lab_network_mismatch');
}
try {
  await identity(); const sender=Wallet.createRandom(), recipient=Wallet.createRandom().address;
  const policy={chainId:'11155111',genesisHash:genesis,account:sender.address,nativeSymbol:'ETH',feeModel:'execution-gas-only',maximumGas:'21000',maximumFeePerGas:'1000000000',maximumExecutionFee:'21000000000000',maximumValue:'1',maximumBlockAge:120,tokens:[]};
  stage='free_testnet_funding';
  fundingDirectory=mkdtempSync(join(tmpdir(),'oathconnect-sepolia-'));
  writeFileSync(join(fundingDirectory,'funding.json'),JSON.stringify({network:'Sepolia',chain,address:sender.address,expires:Date.now()+1200000})+'\n',{mode:0o600,flag:'wx'});
  console.log(JSON.stringify({stage,address:sender.address,publicFundingFile:join(fundingDirectory,'funding.json'),expiresInSeconds:1200}));
  let funded=false;
  for(let attempt=0;attempt<240;attempt++){
    const balance=await rpc.request('eth_getBalance',[sender.address,'latest'],bounded());
    check(typeof balance==='string'&&/^0x[0-9a-f]+$/.test(balance),'evm_lab_balance_invalid');
    if(BigInt(balance)>=21000000000001n){funded=true;break;}
    await delay(5000);
  }
  check(funded,'evm_lab_funding_timeout'); await identity();
  stage='pair'; relay=await validationRelay();
  const p=await createPairing(relay.audience),w=await joinPairing(p.uri,relay.audience);
  const dc=relay.client(p.invitation.session,'dapp',await createIdentity()),wc=relay.client(p.invitation.session,'wallet',await createIdentity());
  await dc.create(p.invitation.expires);await wc.join(w.hello);
  dapp=new Session(await p.accept(await dc.hello()),dc,relay.projects);wallet=new Session(w.channel,wc,relay.projects);
  const cap={chain,account:sender.address,methods:['eth_sendTransaction']};
  await Promise.all([dapp.propose([{chain,methods:cap.methods}]),wallet.approveSession(async()=>[cap])]);
  stage='prepare';
  const nonce=await rpc.request('eth_getTransactionCount',[sender.address,'pending'],bounded());
  const before=BigInt(await rpc.request('eth_getBalance',[recipient,'latest'],bounded()));
  const params=[{type:'0x2',chainId:'0xaa36a7',from:sender.address,to:recipient,nonce,gas:'0x5208',value:'0x1',data:'0x',maxFeePerGas:toQuantity(1000000000n),maxPriorityFeePerGas:toQuantity(100000000n)}];
  const adapter=new EvmAdapter(policy,{
    inspect:(plan,signal)=>rpc.inspect(plan,signal),
    async sign(unsigned,context){
      stage='sign';context.assertActive();check(++executions===1,'evm_lab_duplicate_sign');
      return sender.signTransaction(Transaction.from(unsigned));
    },
    async broadcast(signed,signal){
      stage='broadcast';check(++broadcasts===1,'evm_lab_duplicate_broadcast');
      transactionHash=Transaction.from(signed).hash;
      // Preserve the public hash before submission so an interrupted run can be reconciled.
      writeEvidence(evidenceName,{started,commit,dirty,chain,network:'Ethereum Sepolia',status:'broadcast_pending',hash:transactionHash,transactionConfirmed:false,decisions,executions,broadcasts});
      return rpc.broadcast(signed,signal);
    }
  });
  authorizer=new WalletAuthorizer([cap],new Map([[chain+'/eth_sendTransaction',adapter]]),async(request,review,context)=>{
    context.assertActive();check(canonical(request.params)===canonical(params),'evm_lab_policy_mismatch');
    decisions++;return{approved:true,requestDigest:review.requestDigest};
  });
  stage='request';const [result]=await Promise.all([dapp.request(cap,'eth_sendTransaction',params),wallet.serveOnce(authorizer)]);
  check(result?.hash===transactionHash&&decisions===1&&executions===1&&broadcasts===1,'evm_lab_result_mismatch');
  stage='receipt';let receipt;
  // Read-only reconciliation, including an uncertain broadcast; never resubmit.
  for(let attempt=0;attempt<60;attempt++){
    receipt=await rpc.request('eth_getTransactionReceipt',[transactionHash],bounded());
    if(receipt)break;await delay(5000);
  }
  check(receipt?.transactionHash===transactionHash&&receipt?.status==='0x1'&&receipt?.from?.toLowerCase()===sender.address.toLowerCase()&&receipt?.to?.toLowerCase()===recipient.toLowerCase()&&receipt?.gasUsed==='0x5208'&&receipt?.logs?.length===0,'evm_lab_receipt_unconfirmed');
  const canonicalBlock=await rpc.request('eth_getBlockByNumber',[receipt.blockNumber,false],bounded());
  check(canonicalBlock?.hash===receipt.blockHash,'evm_lab_receipt_reorg');
  const after=BigInt(await rpc.request('eth_getBalance',[recipient,{blockHash:receipt.blockHash,requireCanonical:true}],bounded()));
  check(after-before===1n,'evm_lab_balance_change');await identity();
  const evidence={started,completed:new Date().toISOString(),commit,dirty,chain,network:'Ethereum Sepolia',genesisHash:genesis,rpc:endpoint,transport:relay.description,...(relay.deployedCommit?{deployedCommit:relay.deployedCommit}:{}),status:'confirmed',transactionConfirmed:true,finality:'canonical inclusion; finalized checkpoint not checked',hash:transactionHash,block:BigInt(receipt.blockNumber).toString(),blockHash:receipt.blockHash,gasUsed:'21000',effectiveGasPrice:BigInt(receipt.effectiveGasPrice).toString(),recipientBalanceIncrease:'1',decisions,executions,broadcasts,submissionStatus:result.status,operation:'One wei native transfer using reusable EvmAdapter',thorchainSwap:false,productionReady:false};
  writeEvidence(evidenceName,evidence);console.log(JSON.stringify(evidence));
} catch(error) {
  const code=error instanceof ProtocolError&&/^[a-z0-9_]{1,100}$/.test(error.code)?error.code:'unclassified';
  const evidence={started,completed:new Date().toISOString(),commit,dirty,network:'Ethereum Sepolia',chain,stage,status:'blocked_or_failed',code,transactionConfirmed:false,decisions,executions,broadcasts,...(transactionHash?{hash:transactionHash}:{}),productionReady:false};
  writeEvidence(evidenceName,evidence);console.log(JSON.stringify(evidence));process.exitCode=1;
} finally {
  authorizer?.close();await dapp?.close().catch(()=>{});await wallet?.close().catch(()=>{});await relay?.dispose();
  if(fundingDirectory)rmSync(fundingDirectory,{recursive:true});
}
