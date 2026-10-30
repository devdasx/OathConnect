import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Wallet,Transaction,toQuantity} from 'ethers';
import {canonical,nowSeconds} from '@oathconnect/protocol';
import {WalletAuthorizer,newRequest} from '@oathconnect/sdk';
import {EvmAdapter,decodeEvmTransaction} from '@oathconnect/evm';
import {NETWORK,RECIPIENT,GAS,PRICE,VALUE,policyFor,paramsFor,quantity,verifyNetwork,balanceSnapshot,verifyReceipt,confirmReceipt} from './core.mjs';
const h=n=>'0x'+n.toString(16).padStart(64,'0');
function evidence(){
 const sender=Wallet.createRandom().address;
 const before={blockNumber:'0x9',blockHash:h(9),senderBalance:toQuantity(GAS*PRICE+101n),recipientBalance:'0x64'};
 const expected={hash:h(200),sender,before};
 const receipt={status:'0x1',type:'0x0',transactionHash:expected.hash,from:sender.toLowerCase(),to:RECIPIENT.toLowerCase(),contractAddress:null,gasUsed:'0x5208',effectiveGasPrice:'0x3b9aca00',logs:[],blockHash:h(10),blockNumber:'0xa',transactionIndex:'0x0'};
 return {expected,receipt};
}
function reader(f,override){
 const calls=[];
 return {calls,async request(method,params,signal){
  assert.equal(signal.aborted,false);calls.push({method,params});
  const changed=override?.(method,params);if(changed!==undefined)return changed;
  if(method==='eth_chainId')return NETWORK.chainHex;
  if(method==='eth_getBlockByNumber'){
   if(params[0]==='0x0')return {number:'0x0',hash:NETWORK.genesis};
   const n=params[0]==='finalized'?'0xb':params[0]==='latest'?'0x9':params[0];
   return {number:n,hash:h(Number(BigInt(n)))};
  }
  if(method==='eth_getBalance')return params[0]===f.expected.sender?'0x64':'0x65';
  throw Error('unexpected RPC method');
 }};
}
test('fixed legacy BNB policy binds chain, test sink address, one wei and exact fee ceiling',()=>{
 const account=Wallet.createRandom().address,params=paramsFor(account),cap={chain:NETWORK.chain,account,methods:['eth_sendTransaction']};
 const request=newRequest(cap,'eth_sendTransaction',params),plan=decodeEvmTransaction(request,policyFor(account)),tx=Transaction.from(plan.unsignedSerialized);
 assert.equal(tx.chainId,97n);assert.equal(tx.type,0);assert.equal(tx.to,RECIPIENT);assert.equal(tx.value,VALUE);assert.equal(tx.gasLimit,GAS);assert.equal(tx.gasPrice,PRICE);assert.equal(tx.nonce,0);assert.equal(tx.data,'0x');assert.equal(Object.isFrozen(NETWORK),true);
 for(const change of [p=>p.chainId='0x38',p=>p.gas='0x5209',p=>p.gasPrice='0x3b9aca01',p=>p.value='0x2',p=>p.data='0x00']){
  const altered=structuredClone(request);change(altered.params[0]);assert.throws(()=>decodeEvmTransaction(altered,policyFor(account)));
 }
 for(const q of ['0x00','0x','1','0xA','0x'+'f'.repeat(65)])assert.throws(()=>quantity(q));
});
test('network mismatch rejects both a mainnet chain ID and a different genesis',async()=>{
 const f=evidence();await verifyNetwork(reader(f),AbortSignal.timeout(1000));
 for(const mode of ['chain','genesis'])await assert.rejects(()=>verifyNetwork(reader(f,(m,p)=>mode==='chain'&&m==='eth_chainId'?'0x38':mode==='genesis'&&m==='eth_getBlockByNumber'&&p[0]==='0x0'?{number:'0x0',hash:h(1)}:undefined),AbortSignal.timeout(1000)),{code:'bnb_network_mismatch'});
});
test('funded snapshot pins both balance reads and rejects used senders or missing recipients',async()=>{
 const f=evidence();
 const make=patch=>reader(f,(m,p)=>patch?.(m,p)??(m==='eth_getBalance'?(p[0]===f.expected.sender?f.expected.before.senderBalance:f.expected.before.recipientBalance):m==='eth_getTransactionCount'?'0x0':m==='eth_getCode'?'0x':undefined));
 const rpc=make();const result=await balanceSnapshot(rpc,f.expected.sender,AbortSignal.timeout(1000));assert.deepEqual(result,f.expected.before);
 for(const c of rpc.calls.filter(c=>['eth_getBalance','eth_getCode'].includes(c.method)))assert.deepEqual(c.params[1],{blockHash:h(9),requireCanonical:true});
 for(const change of [(m)=>m==='eth_getTransactionCount'?'0x1':undefined,(m,p)=>m==='eth_getBalance'&&p[0]===RECIPIENT?'0x0':undefined,m=>m==='eth_getCode'?'0x00':undefined])await assert.rejects(()=>balanceSnapshot(make(change),f.expected.sender,AbortSignal.timeout(1000)),{code:'bnb_fixed_policy_unavailable'});
});
test('receipt rejects changed identity, status, type, gas, fee, logs and pre-snapshot blocks',()=>{
 const f=evidence();assert.equal(verifyReceipt(f.receipt,f.expected).block,'10');
 for(const change of [r=>r.status='0x0',r=>r.type='0x2',r=>r.transactionHash=h(201),r=>r.from=RECIPIENT,r=>r.to=f.expected.sender,r=>r.contractAddress=RECIPIENT,r=>r.gasUsed='0x5209',r=>r.effectiveGasPrice='0x3b9aca01',r=>r.logs=[{}],r=>r.blockHash='bad',r=>r.blockNumber='0x9',r=>r.transactionIndex='0x00']){const r=structuredClone(f.receipt);change(r);assert.throws(()=>verifyReceipt(r,f.expected));}
});
test('confirmation verifies both balance effects and consistent canonical/finalized blocks without sending',async()=>{
 const f=evidence(),rpc=reader(f);const result=await confirmReceipt(rpc,f.receipt,f.expected,AbortSignal.timeout(1000));
 assert.equal(result.recipientBalanceIncrease,'1');assert.equal(result.senderBalanceDecrease,(GAS*PRICE+VALUE).toString());assert.equal(result.finalizedHeight,'11');assert.equal(rpc.calls.some(c=>c.method==='eth_sendRawTransaction'),false);
 for(const c of rpc.calls.filter(c=>c.method==='eth_getBalance'))assert.deepEqual(c.params[1],{blockHash:f.receipt.blockHash,requireCanonical:true});
});
test('confirmation rejects wrong balances, reorgs, lagging or contradictory finality',async()=>{
 const f=evidence();const cases=[
  [(m,p)=>m==='eth_getBalance'&&p[0]===f.expected.sender?'0x63':undefined,'bnb_balance_effect_mismatch'],
  [(m,p)=>m==='eth_getBalance'&&p[0]===RECIPIENT?'0x66':undefined,'bnb_balance_effect_mismatch'],
  [(m,p)=>m==='eth_getBlockByNumber'&&p[0]==='0x9'?{number:'0x9',hash:h(99)}:undefined,'bnb_canonical_block_mismatch'],
  [(m,p)=>m==='eth_getBlockByNumber'&&p[0]==='0xa'?{number:'0xa',hash:h(99)}:undefined,'bnb_canonical_block_mismatch'],
  [(m,p)=>m==='eth_getBlockByNumber'&&p[0]==='finalized'?{number:'0x9',hash:h(9)}:undefined,'bnb_finality_unconfirmed'],
  [(m,p)=>m==='eth_getBlockByNumber'&&p[0]==='0xb'?{number:'0xb',hash:h(99)}:undefined,'bnb_finality_mismatch']
 ];for(const [change,code] of cases)await assert.rejects(()=>confirmReceipt(reader(f,change),f.receipt,f.expected,AbortSignal.timeout(1000)),{code});
});
test('legacy signing has one exact approval/signature/submission and never retries ambiguity',async()=>{
 for(const ambiguous of [false,true]){
  const signer=Wallet.createRandom(),params=paramsFor(signer.address),cap={chain:NETWORK.chain,account:signer.address,methods:['eth_sendTransaction']};
  let approvals=0,signs=0,sends=0;
  const adapter=new EvmAdapter(policyFor(signer.address),{
   async inspect(){return {chainId:NETWORK.chainId,genesisHash:NETWORK.genesis,blockHash:h(1),blockTimestamp:nowSeconds(),observedAt:nowSeconds(),pendingNonce:'0',balance:(GAS*PRICE+VALUE).toString(),senderCode:'0x',destinationCode:'0x',destinationBalance:'1',destinationNonce:'0',tokenBalance:null,allowance:null,simulationReturn:'0x'};},
   async sign(bytes,c){c.assertActive();signs++;return signer.signTransaction(Transaction.from(bytes));},
   async broadcast(bytes){sends++;assert.equal(Transaction.from(bytes).from,signer.address);if(ambiguous)throw Error('ambiguous');return Transaction.from(bytes).hash;}
  });
  const authorizer=new WalletAuthorizer([cap],new Map([[NETWORK.chain+'/eth_sendTransaction',adapter]]),async(r,review,c)=>{c.assertActive();assert.equal(canonical(r.params),canonical(params));approvals++;return {approved:true,requestDigest:review.requestDigest};});
  try{const request=newRequest(cap,'eth_sendTransaction',params),result=await authorizer.handle(request);assert.equal(result.status,ambiguous?'broadcast_unknown':'submitted');await assert.rejects(()=>authorizer.handle(request));assert.deepEqual([approvals,signs,sends],[1,1,1]);}finally{authorizer.close();}
 }
});
