// Explicitly testnet-only. Keys are generated in memory and never written or logged.
import {Client, Wallet} from 'xrpl';
import {mkdirSync, writeFileSync} from 'node:fs';
import {canonical, createIdentity, createPairing, digest, joinPairing, ProtocolError} from '@oathconnect/protocol';
import {Session, WalletAuthorizer} from '@oathconnect/sdk';
import {validationRelay} from '../support/relay.mjs';

const endpoint = 'wss://s.altnet.rippletest.net:51233';
const chain = 'xrpl:1';
const client = new Client(endpoint, {connectionTimeout: 15_000, timeout: 20_000});
let relay, dapp, walletSession;
let stage = 'connect';
const started = new Date().toISOString();
try {
  await client.connect();
  const info = await client.request({command: 'server_info'});
  if (info.result.info.network_id !== 1) throw Error('network_mismatch');
  stage = 'fund_disposable_accounts';
  const sender = Wallet.generate(), receiver = Wallet.generate();
  await client.fundWallet(sender, {faucetHost: 'faucet.altnet.rippletest.net', amount: '10', usageContext: 'OathConnect open-source testnet qualification'});
  await client.fundWallet(receiver, {faucetHost: 'faucet.altnet.rippletest.net', amount: '10', usageContext: 'OathConnect open-source testnet qualification'});
  stage = 'pair';
  relay = await validationRelay(); const pairing = await createPairing(relay.audience); const joined = await joinPairing(pairing.uri, relay.audience);
  const dc = relay.client(pairing.invitation.session, 'dapp', await createIdentity()); const wc = relay.client(pairing.invitation.session, 'wallet', await createIdentity());
  stage = 'relay_create'; await dc.create(pairing.invitation.expires);
  stage = 'relay_join'; await wc.join(joined.hello);
  dapp = new Session(await pairing.accept(await dc.hello()), dc, relay.projects); walletSession = new Session(joined.channel, wc, relay.projects);
  const cap = {chain, account: sender.address, methods: ['xrpl_signAndSubmit']};
  stage = 'negotiate'; await Promise.all([dapp.propose([{chain, methods: cap.methods}]), walletSession.approveSession(async () => [cap])]);
  stage = 'prepare_testnet_payment';
  // XRPL autofill may include undefined optional fields; normalize to the exact JSON wire representation.
  const transaction = JSON.parse(JSON.stringify(await client.autofill({TransactionType: 'Payment', Account: sender.address, Destination: receiver.address, Amount: '1'})));
  const expected = canonical(transaction); let executions = 0, decisions = 0;
  const authorizer = new WalletAuthorizer([cap], new Map([[`${chain}/xrpl_signAndSubmit`, {
    async review(request) {
      if (request.chain !== chain || request.account !== sender.address || canonical(request.params) !== expected || transaction.TransactionType !== 'Payment' || transaction.Destination !== receiver.address || transaction.Amount !== '1' || BigInt(transaction.Fee) > 100n) throw Error('test_policy_rejected');
      return {requestDigest: await digest(canonical(request)), summary: 'Send exactly 1 testnet drop between two newly generated disposable accounts; fee no more than 100 drops.', warnings: ['Testnet fixture. This adapter is not a general-purpose wallet signer.']};
    },
    async execute(request) {
      if (++executions !== 1 || canonical(request.params) !== expected) throw Error('unexpected_execution');
      const current = await client.request({command: 'server_info'}); if (current.result.info.network_id !== 1) throw Error('network_mismatch');
      const signed = sender.sign(structuredClone(request.params));
      const result = await client.submitAndWait(signed.tx_blob);
      if (!result.result.validated || typeof result.result.meta !== 'object' || result.result.meta.TransactionResult !== 'tesSUCCESS') throw Error('transaction_not_confirmed');
      return {hash: signed.hash, ledger: result.result.ledger_index, result: result.result.meta.TransactionResult};
    }
  }]]), async (_, review) => {decisions++; return {approved: true, requestDigest: review.requestDigest};});
  stage = 'request_sign_and_confirm';
  const [result] = await Promise.all([dapp.request(cap, cap.methods[0], transaction), walletSession.serveOnce(authorizer)]);
  const evidence = {started, completed: new Date().toISOString(), chain, network: 'XRP Ledger Testnet', rpc: endpoint, transport: relay.description, ...(relay.deployedCommit ? {deployedCommit:relay.deployedCommit} : {}), operation: 'Payment of 1 drop between disposable testnet accounts', status: 'confirmed', ...result, decisions, executions, thorchainSwap: false};
  mkdirSync('evidence', {recursive:true}); writeFileSync(process.env.OATHCONNECT_LIVE_VALIDATION === 'true' ? 'evidence/xrpl-testnet-live.json' : 'evidence/xrpl-testnet.json', JSON.stringify(evidence,null,2)+'\n'); console.log(JSON.stringify(evidence));
} catch (error) {
  const code = error instanceof ProtocolError ? error.code : error?.constructor?.name;
  const evidence = {started, completed: new Date().toISOString(), chain, network: 'XRP Ledger Testnet', stage, status: 'blocked_or_failed', transactionConfirmed: false, code: /^[a-zA-Z0-9_]{1,100}$/.test(code) ? code : 'unclassified'};
  mkdirSync('evidence', {recursive:true}); writeFileSync(process.env.OATHCONNECT_LIVE_VALIDATION === 'true' ? 'evidence/xrpl-testnet-live.json' : 'evidence/xrpl-testnet.json', JSON.stringify(evidence,null,2)+'\n'); console.log(JSON.stringify(evidence)); process.exitCode = 1;
} finally {
  if (dapp) await dapp.close().catch(() => {});
  if (walletSession) await walletSession.close().catch(() => {});
  if (relay) await relay.dispose();
  await client.disconnect().catch(() => {});
}
