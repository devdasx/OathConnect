import{test}from'node:test';import assert from'node:assert/strict';
import{SolanaLabRpc,SolanaLabRpcError}from'./rpc.mjs';
const response=(request,value)=>new Response(JSON.stringify({jsonrpc:'2.0',id:JSON.parse(request.body).id,result:value}));
test('RPC has fixed HTTPS destination, bound method/id and no redirects or retries',async()=>{
 let calls=0;const rpc=new SolanaLabRpc(async(url,request)=>{calls++;assert.equal(url,'https://api.devnet.solana.com');assert.equal(request.redirect,'error');assert.equal(request.credentials,'omit');assert.equal(request.cache,'no-store');return response(request,'devnet');});
 assert.equal(await rpc.request('getGenesisHash'),'devnet');await assert.rejects(()=>rpc.request('requestAirdrop'),{code:'solana_rpc_unsupported_method'});assert.equal(calls,1);
});
test('HTTP and provider failures expose only safe method/status/code',async()=>{
 let cancelled=false,calls=0;const rpc=new SolanaLabRpc(async()=>{calls++;return new Response(new ReadableStream({cancel(){cancelled=true;}}),{status:429});});
 await assert.rejects(()=>rpc.request('sendTransaction',['secret']),error=>error instanceof SolanaLabRpcError&&error.status===429&&error.method==='sendTransaction'&&!JSON.stringify(error).includes('secret'));assert.equal(cancelled,true);assert.equal(calls,1);
 const provider=new SolanaLabRpc(async(_,request)=>new Response(JSON.stringify({jsonrpc:'2.0',id:JSON.parse(request.body).id,error:{code:-32002,message:'SECRET signed bytes',data:'SECRET'}})));
 await assert.rejects(()=>provider.request('simulateTransaction',['secret']),error=>error.providerCode===-32002&&!JSON.stringify(error).includes('SECRET'));
 const transport=new SolanaLabRpc(async()=>{throw Error('SECRET');});await assert.rejects(()=>transport.request('getBalance',[]),{code:'solana_rpc_delivery_unknown'});
});
test('oversized, mismatched, ambiguous or malformed responses fail closed',async()=>{
 const fetchers=[async()=>new Response('x'.repeat(65537)),async()=>new Response(JSON.stringify({jsonrpc:'2.0',id:'wrong',result:1})),async(_,request)=>new Response('{"jsonrpc":"2.0","id":'+JSON.stringify(JSON.parse(request.body).id)+',"result":1,"result":2}'),async()=>new Response(Uint8Array.from([255]))];
 for(const fetcher of fetchers)await assert.rejects(()=>new SolanaLabRpc(fetcher).request('getGenesisHash'));
 const controller=new AbortController();controller.abort();let calls=0;await assert.rejects(()=>new SolanaLabRpc(async()=>{calls++;}).request('getGenesisHash',[],controller.signal),{code:'solana_rpc_cancelled'});assert.equal(calls,0);
});
test('duplicate-key rejection includes escaped/nested aliases without confusing string contents',async()=>{
 const envelopes=[
  id=>'{"jsonrpc":"2.0","id":'+JSON.stringify(id)+',"result":{"slot":1,"sl\\u006ft":2}}',
  id=>'{"jsonrpc":"2.0","id":'+JSON.stringify(id)+',"result":[{"x":1,"x":2}]}',
  id=>'{"jsonrpc":"2.0","id":'+JSON.stringify(id)+',"result":'+ '['.repeat(25)+'1'+']'.repeat(25)+'}'
 ];
 for(const encode of envelopes){const rpc=new SolanaLabRpc(async(_,request)=>new Response(encode(JSON.parse(request.body).id)));await assert.rejects(()=>rpc.request('getGenesisHash'));}
 const data={nested:[{same:'quotes " and braces { }, commas , slash \\'},{same:'allowed separate object'}],other:{same:3}};
 const rpc=new SolanaLabRpc(async(_,request)=>response(request,data));assert.deepEqual(await rpc.request('getGenesisHash'),data);
});
