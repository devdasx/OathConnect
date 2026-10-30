import {test} from 'node:test';
import assert from 'node:assert/strict';
import {reconcileReceipt} from './reconcile-core.mjs';
const expected={status:'confirmed',transactionConfirmed:true,chain:'eip155:11155111',hash:'0x'+'a'.repeat(64),blockHash:'0x'+'b'.repeat(64),block:'100'};
function reader(endpoint,overrides={}) {
  const calls=[];
  return {endpoint,calls,rpc:{async request(method,params,signal){
    assert.equal(signal.aborted,false);calls.push([method,params]);
    if(method==='eth_chainId')return overrides.chain??'0xaa36a7';
    if(method==='eth_getTransactionReceipt')return {status:'0x1',transactionHash:expected.hash,blockHash:expected.blockHash,blockNumber:'0x64',...overrides.receipt};
    if(method==='eth_getBlockByNumber'&&params[0]==='finalized')return {number:'0x65',hash:'0x'+'c'.repeat(64),...overrides.finalized};
    if(method==='eth_getBlockByNumber'&&params[0]==='0x64')return {number:'0x64',hash:expected.blockHash,...overrides.canonical};
    throw Error('Unexpected or mutating RPC request');
  }}};
}
test('finality requires both provider heights and issues only receipt/block/identity reads',async()=>{
  const a=reader('https://one.invalid'),b=reader('https://two.invalid');
  const result=await reconcileReceipt(expected,[a,b]);
  assert.equal(result.transactionConfirmed,true);assert.equal(result.finalizedByBothProviders,true);assert.equal(result.productionReady,false);
  assert.equal(a.calls.length,4);assert.equal(b.calls.length,4);
  const lagged=await reconcileReceipt(expected,[a,reader('https://two.invalid',{finalized:{number:'0x63'}})]);
  assert.equal(lagged.transactionConfirmed,true);assert.equal(lagged.finalizedByBothProviders,false);
});
test('wrong network, receipt replacement, reorg and malformed finality cannot become a passed check',async()=>{
  for(const overrides of [{chain:'0x1'},{receipt:{status:'0x0'}},{receipt:{transactionHash:'0x'+'d'.repeat(64)}},{receipt:{blockHash:'0x'+'d'.repeat(64)}},{receipt:{blockNumber:'0x65'}},{canonical:{hash:'0x'+'d'.repeat(64)}},{canonical:{number:'0x65'}},{finalized:{number:'0x064'}},{finalized:{hash:'malformed'}}]) {
    await assert.rejects(()=>reconcileReceipt(expected,[reader('https://one.invalid'),reader('https://two.invalid',overrides)]),error=>/^evm_reconciliation_/.test(error.code));
  }
});
test('unconfirmed evidence or duplicate providers cannot claim cross-provider confirmation',async()=>{
  const a=reader('https://one.invalid'),b=reader('https://two.invalid');
  for(const change of [{status:'broadcast_pending'},{transactionConfirmed:false},{chain:'eip155:1'},{hash:'malformed'},{block:'01'}])await assert.rejects(()=>reconcileReceipt({...expected,...change},[a,b]),{code:'evm_reconciliation_invalid_evidence'});
  await assert.rejects(()=>reconcileReceipt(expected,[a,a]),{code:'evm_reconciliation_invalid_readers'});
  assert.equal(a.calls.length,0);assert.equal(b.calls.length,0);
});
