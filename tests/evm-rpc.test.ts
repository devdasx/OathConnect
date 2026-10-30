import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Wallet} from 'ethers';
import {nowSeconds,random} from '@oathconnect/protocol';
import {EvmRpc,EvmRpcError,decodeEvmTransaction,type EvmPolicy} from '@oathconnect/evm';
const genesis='0x'+'11'.repeat(32),blockHash='0x'+'22'.repeat(32),account=Wallet.createRandom().address,recipient=Wallet.createRandom().address;
const policy:EvmPolicy={chainId:'11155111',genesisHash:genesis,account,nativeSymbol:'ETH',feeModel:'gas-limit-times-price',maximumGas:'21000',maximumFeePerGas:'1000000000',maximumGasFee:'21000000000000',maximumValue:'1',maximumBlockAge:120,tokens:[]};
const plan=()=>decodeEvmTransaction({type:'request',id:random(16),chain:'eip155:11155111',account,method:'eth_sendTransaction',expires:nowSeconds()+120,params:[{type:'0x2',chainId:'0xaa36a7',from:account,to:recipient,nonce:'0x0',gas:'0x5208',value:'0x1',data:'0x',maxFeePerGas:'0x3b9aca00',maxPriorityFeePerGas:'0x1'}]},policy);
const signal=()=>new AbortController().signal;
test('EVM RPC pins all state reads and simulation to one canonical block',async()=>{
  const calls:Array<{method:string;params:unknown[]}>=[];
  const rpc=new EvmRpc('https://rpc.example.org/private-api-key',async(input,init)=>{
    assert.equal(String(input),'https://rpc.example.org/private-api-key');assert.equal(init?.redirect,'error');assert.equal(init?.credentials,'omit');
    const q=JSON.parse(init!.body as string);calls.push(q);let result:unknown;
    if(q.method==='eth_chainId')result='0xaa36a7';
    else if(q.method==='eth_getBlockByNumber')result={number:q.params[0]==='0x0'?'0x0':'0x10',hash:q.params[0]==='0x0'?genesis:blockHash,timestamp:'0x'+nowSeconds().toString(16)};
    else if(q.method==='eth_getTransactionCount')result='0x0';
    else if(q.method==='eth_getBalance')result='0x100000000000000000';
    else result='0x';
    return Response.json({jsonrpc:'2.0',id:q.id,result});
  });
  const state=await rpc.inspect(plan(),signal());assert.equal(state.genesisHash,genesis);assert.equal(state.blockHash,blockHash);assert.equal(state.chainId,'11155111');
  for(const q of calls.filter(q=>(['eth_getCode','eth_getBalance','eth_call'].includes(q.method)||(q.method==='eth_getTransactionCount'&&q.params[1]!=='pending'))))assert.deepEqual(q.params[1],{blockHash,requireCanonical:true});
  assert.equal(calls.filter(q=>q.method==='eth_chainId').length,2);
  assert.ok(calls.some(q=>q.method==='eth_getBlockByNumber'&&q.params[0]==='0x10'));
});
test('EVM RPC rejects wrong response IDs, provider errors, oversized replies and unsafe endpoints without leaking raw text',async()=>{
  for(const kind of ['id','error','large','json','network','http']){
    let attempts=0;
    const rpc=new EvmRpc('https://rpc.example.org/secret',async(_,init)=>{
      attempts++;const q=JSON.parse(init!.body as string);
      if(kind==='network')throw Error('signed transaction secret body');
      if(kind==='http')return new Response('signed transaction secret body',{status:500});
      if(kind==='large')return new Response('x'.repeat(262145));
      if(kind==='json')return new Response('secret body not JSON');
      return Response.json(kind==='error'?{jsonrpc:'2.0',id:q.id,error:{code:-32000,message:'signed transaction secret body'}}:{jsonrpc:'2.0',id:'wrong',result:'0x1'});
    });
    await assert.rejects(rpc.request('eth_sendRawTransaction',['0x00'],signal()),error=>{
      if(kind==='error'){assert.ok(error instanceof EvmRpcError);assert.equal(error.method,'eth_sendRawTransaction');assert.equal(error.providerCode,-32000);assert.ok(!JSON.stringify(error).includes('secret'));}
      return error instanceof Error&&!/secret|signed transaction/.test(error.message);
    });
    assert.equal(attempts,1,kind);
  }
  for(const endpoint of ['http://rpc.example.org','https://user:secret@rpc.example.org','https://rpc.example.org/#secret','not a url'])assert.throws(()=>new EvmRpc(endpoint));
});
test('EVM RPC cancelled and unsupported calls do not reach the network',async()=>{
  let calls=0;const rpc=new EvmRpc('https://rpc.example.org',async()=>{calls++;throw Error('unexpected');});
  const controller=new AbortController();controller.abort();
  await assert.rejects(rpc.broadcast('0x00',controller.signal),/cancelled/);
  await assert.rejects(rpc.request('personal_unlockAccount',[],signal()),/unsupported_method/);assert.equal(calls,0);
});
test('EVM RPC refuses a network switch or reorg during inspection',async()=>{
  for(const change of ['chain','block','height']){
    let chainCalls=0;
    const rpc=new EvmRpc('https://rpc.example.org',async(_,init)=>{
      const q=JSON.parse(init!.body as string);let result:unknown='0x';
      if(q.method==='eth_chainId')result=++chainCalls===2&&change==='chain'?'0x1':'0xaa36a7';
      if(q.method==='eth_getBlockByNumber')result={number:q.params[0]==='0x0'?'0x0':q.params[0]==='0x10'&&change==='height'?'0x11':'0x10',hash:q.params[0]==='0x0'?genesis:q.params[0]==='0x10'&&change==='block'?'0x'+'33'.repeat(32):blockHash,timestamp:'0x'+nowSeconds().toString(16)};
      if(q.method==='eth_getTransactionCount')result='0x0';if(q.method==='eth_getBalance')result='0x100000000000';
      return Response.json({jsonrpc:'2.0',id:q.id,result});
    });
    await assert.rejects(rpc.inspect(plan(),signal()),/state_changed/);
  }
});
