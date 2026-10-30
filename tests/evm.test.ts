import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Wallet, Transaction, keccak256} from 'ethers';
import {nowSeconds, random} from '@oathconnect/protocol';
import {WalletAuthorizer, type ExecutionContext, type SigningRequest, type Review} from '@oathconnect/sdk';
import {decodeEvmTransaction, EvmAdapter, verifyEvmSignature, type EvmPolicy, type EvmState, type EvmHooks} from '@oathconnect/evm';

const sender=Wallet.createRandom(), recipient=Wallet.createRandom().address, token=Wallet.createRandom().address;
const genesis='0x'+'11'.repeat(32), code='0x600160005260206000f3';
const policy=():EvmPolicy=>({chainId:'11155111',genesisHash:genesis,account:sender.address,nativeSymbol:'ETH',feeModel:'gas-limit-times-price',maximumGas:'500000',maximumFeePerGas:'100000000000',maximumGasFee:'1000000000000000',maximumValue:'1000000000000000000',maximumBlockAge:120,tokens:[{address:token,codeHash:keccak256(code),symbol:'TEST',decimals:6,maximumApproval:'1000000'}]});
const transaction=()=>({type:'0x2',chainId:'0xaa36a7',from:sender.address,to:recipient,nonce:'0x0',gas:'0x5208',value:'0x1',data:'0x',maxFeePerGas:'0x3b9aca00',maxPriorityFeePerGas:'0x1'});
function request(tx:unknown=transaction()):SigningRequest{return{type:'request',id:random(16),chain:'eip155:11155111',account:sender.address,method:'eth_sendTransaction',params:[tx],expires:nowSeconds()+120};}
const state=():EvmState=>({chainId:'11155111',genesisHash:genesis,blockHash:'0x'+'22'.repeat(32),blockTimestamp:nowSeconds(),observedAt:nowSeconds(),pendingNonce:'0',balance:'10000000000000000000',senderCode:'0x',destinationCode:'0x',destinationBalance:'1',destinationNonce:'0',tokenBalance:null,allowance:null,simulationReturn:'0x'});
const capability={chain:'eip155:11155111',account:sender.address,methods:['eth_sendTransaction']};
const tokenTx=(selector:string,amount=1n)=>({...transaction(),to:token,gas:'0x186a0',value:'0x0',data:selector+'0'.repeat(24)+recipient.slice(2).toLowerCase()+amount.toString(16).padStart(64,'0')});
const tokenState=():EvmState=>({...state(),destinationCode:code,tokenBalance:'100000000000000000000',allowance:'0',simulationReturn:'0x'+'0'.repeat(63)+'1'});
function fixture(p=policy(),overrides:Partial<EvmHooks>={}){
  let signs=0,broadcasts=0,approvals=0,review:Readonly<Review>|undefined;
  const adapter=new EvmAdapter(p,{
    inspect:async()=>state(),
    sign:async(unsigned)=>{signs++;return sender.signTransaction(Transaction.from(unsigned));},
    broadcast:async signed=>{broadcasts++;return Transaction.from(signed).hash!;},...overrides
  });
  const authorizer=new WalletAuthorizer([capability],new Map([[capability.chain+'/eth_sendTransaction',adapter]]),async(_,r)=>{approvals++;review=r;return{approved:true,requestDigest:r.requestDigest};});
  return{adapter,authorizer,get counts(){return{signs,broadcasts,approvals};},get review(){return review;}};
}

test('EVM native transactions bind network, sender, nonce, exact bytes and a bounded fee',async()=>{
  for(const type of ['0x0','0x2']){
    const tx:Record<string,unknown>={...transaction(),type};
    if(type==='0x0'){delete tx.maxFeePerGas;delete tx.maxPriorityFeePerGas;tx.gasPrice='0x3b9aca00';}
    const f=fixture(),r=request(tx);const plan=decodeEvmTransaction(r,policy());
    assert.equal(plan.kind,'native-transfer');assert.equal(plan.maximumGasFee,'21000000000000');
    const result=await f.authorizer.handle(r) as {hash:string;status:string};
    assert.equal(result.status,'submitted');assert.match(result.hash,/^0x[0-9a-f]{64}$/);
    assert.deepEqual(f.counts,{signs:1,broadcasts:1,approvals:1});
    assert.match(f.review!.summary,/nonce 0; maximum gas fee 0.000021 ETH/);
  }
});
test('EVM strict fields reject hidden authorizations, unsafe quantities, fees and unsupported calls',()=>{
  const cases:Record<string,unknown>[]=[
    {authorizationList:[]},{accessList:[]},{blobs:[]},{input:'0x'},{type:'0x4'},{chainId:'0x1'},
    {from:recipient},{nonce:0},{nonce:'0x00'},{nonce:'0X0'},{gas:'0x5209'},{gas:'0x0'},
    {value:'0x0'},{to:sender.address},{value:'0x'+'f'.repeat(65)},{maxFeePerGas:'0x0'},{maxFeePerGas:'0x'+'f'.repeat(64)},
    {maxPriorityFeePerGas:'0xffffffffff'},{to:'alice.eth'},{to:'0x'+'0'.repeat(40)},
    {to:'0x0000000000000000000000000000000000000001'},{data:'0xdeadbeef'},
  ];
  for(const patch of cases)assert.throws(()=>decodeEvmTransaction(request({...transaction(),...patch}),policy()));
  assert.throws(()=>decodeEvmTransaction({...request(),chain:'eip155:1'},policy()));
  assert.throws(()=>decodeEvmTransaction({...request(),method:'eth_sign'},policy()));
  assert.throws(()=>decodeEvmTransaction({...request(),params:[transaction(),transaction()]},policy()));
});
test('EVM ERC20 review preserves large integers and exact recipient; noncanonical ABI is rejected',async()=>{
  const amount=9_007_199_254_740_993n,tx=tokenTx('0xa9059cbb',amount),r=request(tx);
  const plan=decodeEvmTransaction(r,policy());assert.equal(plan.amount,amount.toString());assert.equal(plan.recipient,recipient);
  const f=fixture(policy(),{inspect:async()=>tokenState()});assert.equal((await f.authorizer.handle(r) as {status:string}).status,'submitted');
  assert.match(f.review!.summary,/9007199254.740993 TEST/);assert.match(f.review!.summary,new RegExp(token));
  for(const data of [tx.data+'00',tx.data.slice(0,-2),tx.data.slice(0,10)+'1'+tx.data.slice(11),'0x23b872dd'+tx.data.slice(10)])assert.throws(()=>decodeEvmTransaction(request({...tx,data}),policy()));
  assert.throws(()=>decodeEvmTransaction(request({...tx,value:'0x1'}),policy()));
});
test('ERC20 approvals are bounded, explicitly described, and require zero-before-nonzero',async()=>{
  const f=fixture(policy(),{inspect:async()=>tokenState()});await f.authorizer.handle(request(tokenTx('0x095ea7b3',500n)));
  assert.match(f.review!.summary,/spending allowance/);assert.ok(f.review!.warnings.some(w=>w.includes('without another OathConnect request')));
  const prior=fixture(policy(),{inspect:async()=>({...tokenState(),allowance:'1'})});
  await assert.rejects(prior.authorizer.handle(request(tokenTx('0x095ea7b3',500n))),/reset_allowance_first/);assert.equal(prior.counts.signs,0);
  const revoke=fixture(policy(),{inspect:async()=>({...tokenState(),allowance:'999999999'})});
  await revoke.authorizer.handle(request(tokenTx('0x095ea7b3',0n)));assert.equal(revoke.counts.broadcasts,1);
  assert.throws(()=>decodeEvmTransaction(request(tokenTx('0x095ea7b3',(1n<<256n)-1n)),policy()),/allowance_limit/);
});
test('trusted-network state rejects wrong genesis, stale blocks, delegation, changed code and false simulation',async()=>{
  for(const patch of [{chainId:'1'},{genesisHash:'0x'+'33'.repeat(32)},{blockTimestamp:nowSeconds()-1000},{observedAt:nowSeconds()-60},{pendingNonce:'1'},{balance:'0'},{senderCode:'0xef0100'+'44'.repeat(20)},{destinationCode:code}]){
    const f=fixture(policy(),{inspect:async()=>({...state(),...patch})});await assert.rejects(f.authorizer.handle(request()));assert.deepEqual(f.counts,{signs:0,broadcasts:0,approvals:0});
  }
  for(const patch of [{destinationCode:'0x00'},{simulationReturn:'0x'+'0'.repeat(64)},{tokenBalance:'0'}]){
    const f=fixture(policy(),{inspect:async()=>({...tokenState(),...patch})});await assert.rejects(f.authorizer.handle(request(tokenTx('0xa9059cbb'))));assert.equal(f.counts.signs,0);
  }
});
test('signed EVM transaction substitution and wrong signing key never reach broadcast',async()=>{
  for(const field of ['chainId','nonce','to','value','gasLimit','data','maxFeePerGas','maxPriorityFeePerGas','key']){
    let broadcasts=0;
    const f=fixture(policy(),{sign:async unsigned=>{
      const tx=Transaction.from(unsigned);
      if(field==='chainId')tx.chainId=1n;if(field==='nonce')tx.nonce=1;if(field==='to')tx.to=sender.address;
      if(field==='value')tx.value=2n;if(field==='gasLimit')tx.gasLimit=22000n;if(field==='data')tx.data='0x00';
      if(field==='maxFeePerGas')tx.maxFeePerGas=2_000_000_000n;if(field==='maxPriorityFeePerGas')tx.maxPriorityFeePerGas=2n;
      return (field==='key'?Wallet.createRandom():sender).signTransaction(tx);
    },broadcast:async()=>{broadcasts++;throw Error('must_not_broadcast');}});
    await assert.rejects(f.authorizer.handle(request()),/signed_transaction_changed/);assert.equal(broadcasts,0,field);
  }
  const plan=decodeEvmTransaction(request(),policy());assert.throws(()=>verifyEvmSignature(plan,plan.unsignedSerialized),/signed_transaction_changed/);
});
test('wallet closure while signing is pending prevents broadcast, and aborts execution context',async()=>{
  let enter!:()=>void,finish!:()=>void,context:Readonly<ExecutionContext>|undefined,broadcasts=0;
  const entered=new Promise<void>(r=>enter=r),wait=new Promise<void>(r=>finish=r);
  const f=fixture(policy(),{sign:async(unsigned,c)=>{context=c;enter();await wait;return sender.signTransaction(Transaction.from(unsigned));},broadcast:async()=>{broadcasts++;return 'unused';}});
  const pending=f.authorizer.handle(request());await entered;f.authorizer.close();assert.equal(context!.signal.aborted,true);finish();
  await assert.rejects(pending,/request_expired/);assert.equal(broadcasts,0);
});
test('session deadline is enforced again after asynchronous signing',async()=>{
  let finish!:()=>void,enter!:()=>void,broadcasts=0;
  const entered=new Promise<void>(r=>enter=r),wait=new Promise<void>(r=>finish=r);
  const f=fixture(policy(),{sign:async(unsigned)=>{enter();await wait;return sender.signTransaction(Transaction.from(unsigned));},broadcast:async()=>{broadcasts++;return 'unused';}});
  const now=nowSeconds(),pending=f.authorizer.handle(request(),now,now+2);await entered;
  await new Promise(r=>setTimeout(r,2100));finish();await assert.rejects(pending,/request_expired/);assert.equal(broadcasts,0);
});
test('changed state after signing and ambiguous broadcasts never trigger retries',async()=>{
  let inspected=0,broadcasts=0;
  const changed=fixture(policy(),{inspect:async()=>({...state(),pendingNonce:++inspected===3?'1':'0'}),broadcast:async()=>{broadcasts++;return 'unused';}});
  await assert.rejects(changed.authorizer.handle(request()),/nonce_changed/);assert.equal(broadcasts,0);
  const unknown=fixture(policy(),{broadcast:async()=>{broadcasts++;throw Error('timeout_after_network_write');}});
  const result=await unknown.authorizer.handle(request()) as {hash:string;status:string};assert.equal(result.status,'broadcast_unknown');assert.match(result.hash,/^0x[0-9a-f]{64}$/);assert.equal(broadcasts,1);
  await assert.rejects(unknown.authorizer.handle(request()),/repair_required/);assert.equal(broadcasts,1);
});
test('policy is snapshotted and concurrent authorizers cannot sign one nonce twice',async()=>{
  const mutable=policy(),f=fixture(mutable),r=request();
  (mutable as {maximumValue:string}).maximumValue='999999999999999999999999999';
  await assert.rejects(f.authorizer.handle(request({...transaction(),value:'0x1bc16d674ec80000'})),/spending_limit/);
  await f.adapter.review(r);
  const context:ExecutionContext={deadline:r.expires,signal:new AbortController().signal,assertActive(){}};
  const results=await Promise.allSettled([f.adapter.execute(r,context),f.adapter.execute(r,context)]);
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(f.counts.signs,1);assert.equal(f.counts.broadcasts,1);
});

test('native transfers exclude new accounts, zero value and self transfers under repriced gas',async()=>{
  const fresh=fixture(policy(),{inspect:async()=>({...state(),destinationBalance:'0',destinationNonce:'0'})});
  await assert.rejects(fresh.authorizer.handle(request()),/account_creation_unsupported/);
  assert.deepEqual(fresh.counts,{signs:0,broadcasts:0,approvals:0});
  const existing=fixture(policy(),{inspect:async()=>({...state(),destinationBalance:'0',destinationNonce:'1'})});
  await existing.authorizer.handle(request());assert.equal(existing.counts.broadcasts,1);
  assert.throws(()=>decodeEvmTransaction(request({...transaction(),value:'0x0'}),policy()),/native_transfer_policy/);
  assert.throws(()=>decodeEvmTransaction(request({...transaction(),to:sender.address}),policy()),/native_transfer_policy/);
});
