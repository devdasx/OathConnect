import {test} from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,randomBytes,sign} from 'node:crypto';
import {CHAIN,GENESIS,buildTransfer,decode64,encode58,verifiedWire} from './transfer.mjs';
import {reconcileReceipt} from './reconcile-core.mjs';
import {labNetwork} from './networks.mjs';
function fixture(){
 const key=generateKeyPairSync('ed25519'),from=encode58(key.publicKey.export({format:'der',type:'spki'}).subarray(-32));
 const message=buildTransfer(from,encode58(randomBytes(32)),encode58(randomBytes(32)));
 const signed=verifiedWire(message,sign(null,decode64(message,150),key.privateKey));
 const expected={chain:CHAIN,genesisHash:GENESIS,signature:signed.signature,slot:101,feeLamports:'5000'};
 const receipt={slot:101,version:'legacy',transaction:[signed.wire,'base64'],meta:{err:null,fee:5000,preBalances:[2000000,0,1],postBalances:[995000,1000000,1],innerInstructions:[]}};
 const statuses={context:{slot:110},value:[{slot:101,err:null,confirmations:null,confirmationStatus:'finalized'}]},calls=[];
 const state={genesis:GENESIS,receipt,statuses};
 const rpc={async request(method,params,signal){assert.equal(signal.aborted,false);calls.push(method);
  if(method==='getGenesisHash')return state.genesis;
  if(method==='getTransaction'){assert.equal(params[0],expected.signature);assert.equal(params[1].commitment,'finalized');return state.receipt;}
  if(method==='getSignatureStatuses'){assert.deepEqual(params,[[expected.signature],{searchTransactionHistory:true}]);return state.statuses;}
  throw Error('Unexpected method');
 }};
 return{expected,state,rpc,calls};
}
test('finality reconciliation verifies signature and effects using only read methods',async()=>{
 const f=fixture(),result=await reconcileReceipt(f.expected,f.rpc);
 assert.equal(result.finalized,true);assert.equal(result.submissions,0);assert.equal(result.signatureVerified,true);
 assert.deepEqual(f.calls,['getGenesisHash','getTransaction','getSignatureStatuses','getGenesisHash']);
 assert.equal(JSON.stringify(result).includes(f.state.receipt.transaction[0]),false);
});
test('missing, unfinalized, failed and inconsistent status never become finalized evidence',async()=>{
 for(const change of [s=>s.receipt=null,s=>s.statuses.value=[null],s=>s.statuses.value[0].confirmationStatus='confirmed',s=>s.statuses.value[0].confirmations=1,s=>s.statuses.value[0].err={},s=>s.statuses.value[0].slot=102,s=>s.statuses.context.slot=100]){
  const f=fixture();change(f.state);await assert.rejects(()=>reconcileReceipt(f.expected,f.rpc));
 }
});
test('changed receipt bytes, signatures, recorded slot and fee are rejected',async()=>{
 for(const change of [f=>f.state.receipt.transaction[0]=fixture().state.receipt.transaction[0],f=>{const b=decode64(f.state.receipt.transaction[0],215);b[70]^=1;f.state.receipt.transaction[0]=b.toString('base64');},f=>f.expected.slot=102,f=>f.expected.feeLamports='4000',f=>f.state.receipt.meta.postBalances[1]--]){
  const f=fixture();change(f);await assert.rejects(()=>reconcileReceipt(f.expected,f.rpc));
 }
});
test('wrong stored or observed genesis fails before a receipt is accepted',async()=>{
 for(const change of [f=>f.expected.chain='solana:mainnet',f=>f.expected.genesisHash='other',f=>f.state.genesis='other']){
  const f=fixture();change(f);await assert.rejects(()=>reconcileReceipt(f.expected,f.rpc));
 }
 const f=fixture(),original=f.rpc.request;f.rpc.request=async(...args)=>{const result=await original(...args);if(args[0]==='getSignatureStatuses')f.state.genesis='other';return result;};await assert.rejects(()=>reconcileReceipt(f.expected,f.rpc));
});
test('testnet reconciliation cannot relabel a devnet receipt or use the devnet provider',async()=>{
 const f=fixture(),network=labNetwork('testnet');
 await assert.rejects(()=>reconcileReceipt(f.expected,f.rpc,'testnet'),{code:'solana_reconciliation_wrong_network'});
 f.expected.chain=network.chain;f.expected.genesisHash=network.genesis;
 await assert.rejects(()=>reconcileReceipt(f.expected,f.rpc,'testnet'),{code:'solana_network_mismatch'});
 f.state.genesis=network.genesis;const result=await reconcileReceipt(f.expected,f.rpc,'testnet');
 assert.equal(result.chain,network.chain);assert.equal(result.provider,network.endpoint);assert.equal(result.finalized,true);
});
