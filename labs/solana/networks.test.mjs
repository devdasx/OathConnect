import {test} from 'node:test';
import assert from 'node:assert/strict';
import {labNetwork} from './networks.mjs';
import {SolanaLabRpc} from './rpc.mjs';
import {CHAIN,GENESIS} from './transfer.mjs';
test('only immutable explicit test networks are allowed; default devnet pins remain unchanged',async()=>{
 assert.equal(labNetwork().genesis,GENESIS);assert.equal(labNetwork().chain,CHAIN);
 for(const name of ['devnet','testnet']){
  const network=labNetwork(name);assert.equal(network.chain,'solana:'+network.genesis.slice(0,32));assert.equal(Object.isFrozen(network),true);
  let calls=0;const rpc=new SolanaLabRpc(async(url,init)=>{calls++;assert.equal(url,network.endpoint);const body=JSON.parse(init.body);return Response.json({jsonrpc:'2.0',id:body.id,result:network.genesis});},name);
  assert.equal(await rpc.request('getGenesisHash'),network.genesis);assert.equal(calls,1);
 }
 for(const name of ['mainnet','mainnet-beta','https://api.mainnet.solana.com','__proto__','constructor','Devnet','',null,{}]){
  assert.throws(()=>labNetwork(name),{code:'solana_lab_unsupported_network'});
  assert.throws(()=>new SolanaLabRpc(()=>{throw Error('must not contact endpoint');},name),{code:'solana_lab_unsupported_network'});
 }
});
