import {test} from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,sign,randomBytes} from 'node:crypto';
import {AMOUNT,CHAIN,GENESIS,SYSTEM,buildTransfer,decodeTransfer,decode58,decode64,encode58,inspectAccounts,verifiedWire,verifyReceipt} from './transfer.mjs';
import {FixedSolanaAdapter} from './adapter.mjs';
import {WalletAuthorizer,newRequest} from '@oathconnect/sdk';
import {canonical,ProtocolError} from '@oathconnect/protocol';
function fixture(){
 const sender=generateKeyPairSync('ed25519'),to=encode58(randomBytes(32)),from=encode58(sender.publicKey.export({format:'der',type:'spki'}).subarray(-32)),blockhash=encode58(randomBytes(32));
 const message=buildTransfer(from,to,blockhash),plan=decodeTransfer(message),signed=verifiedWire(message,sign(null,decode64(message,150),sender.privateKey));
 const accounts={context:{slot:100},value:[{owner:SYSTEM,executable:false,data:['','base64'],lamports:2000000},null]};
 const receipt={slot:101,version:'legacy',transaction:[signed.wire,'base64'],meta:{err:null,fee:5000,preBalances:[2000000,0,1],postBalances:[995000,1000000,1],innerInstructions:[]}};
 return{sender,message,plan,signed,accounts,receipt};
}
test('fixed legacy transfer round trips exact bytes and verifies the real signer',()=>{
 const f=fixture();assert.equal(f.plan.amountLamports,'1000000');assert.equal(decode64(f.signed.wire,215).length,215);assert.equal(verifyReceipt(f.receipt,f.signed).recipientBalanceIncrease,'1000000');
 assert.deepEqual(decode58(SYSTEM,32),Buffer.alloc(32));for(const n of [32,64]){const b=randomBytes(n);b[0]=0;assert.deepEqual(decode58(encode58(b),n),b);}
 const other=generateKeyPairSync('ed25519');assert.throws(()=>verifiedWire(f.message,sign(null,decode64(f.message,150),other.privateKey)),{code:'solana_invalid_signature'});
});
test('versioned, extra, reordered, malformed and altered-amount messages fail closed',()=>{
 const f=fixture(),bytes=decode64(f.message,150);
 for(const offset of [0,1,2,3,68,132,133,134,135,136,137,138,142]){const b=Buffer.from(bytes);b[offset]^=1;assert.throws(()=>decodeTransfer(b.toString('base64')));}
 for(const message of [f.message+'AAAA',f.message+'\n',f.message.replace(/^./,' '),Buffer.concat([bytes,Buffer.from([0])]).toString('base64')])assert.throws(()=>decodeTransfer(message));
 assert.throws(()=>buildTransfer(f.plan.from,f.plan.from,f.plan.blockhash));assert.throws(()=>buildTransfer(f.plan.from,SYSTEM,f.plan.blockhash));assert.throws(()=>decode58('0'.repeat(32),32));
});
test('receipt comparison rejects different bytes, failed execution, fees and unexpected balances',()=>{
 const f=fixture();
 const changes=[r=>r.transaction[0]=fixture().signed.wire,r=>r.version=0,r=>r.meta.err={},r=>r.meta.fee=10001,r=>r.meta.fee=Number.MAX_SAFE_INTEGER+1,r=>r.meta.postBalances[0]--,r=>r.meta.postBalances[1]--,r=>r.meta.postBalances[2]++,r=>r.meta.preBalances[1]=1,r=>r.meta.innerInstructions=[{}]];
 for(const change of changes){const r=structuredClone(f.receipt);change(r);assert.throws(()=>verifyReceipt(r,f.signed));}
});
test('account state rejects code, non-system ownership, stale context and preexisting receiver',()=>{
 const f=fixture();assert.equal(inspectAccounts(f.accounts,f.plan,100),100);
 for(const change of [r=>r.context.slot=99,r=>r.value[0].data=['AA==','base64'],r=>r.value[0].owner=f.plan.to,r=>r.value[0].executable=true,r=>r.value[0].lamports=Number(AMOUNT),r=>r.value[1]={}]){const r=structuredClone(f.accounts);change(r);assert.throws(()=>inspectAccounts(r,f.plan,100));}
});
function adapterFixture({send='ok',onSign,override}={}){
 const f=fixture(),calls=[],state={signs:0,preserved:[],sends:0};
 const rpc={async request(method,params,signal){assert.equal(signal.aborted,false);calls.push([method,params]);if(override){const out=await override(method,params);if(out!==undefined)return out;}
  if(method==='getGenesisHash')return GENESIS;
  if(method==='getMultipleAccounts')return f.accounts;
  if(method==='isBlockhashValid')return{context:{slot:100},value:true};
  if(method==='getFeeForMessage')return{context:{slot:100},value:5000};
  if(method==='getMinimumBalanceForRentExemption')return 890880;
  if(method==='simulateTransaction'){assert.equal(params[1].replaceRecentBlockhash,false);return{context:{slot:100},value:{err:null}};}
  if(method==='sendTransaction'){state.sends++;assert.equal(params[0],f.signed.wire);assert.equal(params[1].maxRetries,0);assert.equal(params[1].skipPreflight,false);assert.deepEqual(state.preserved,[f.signed.signature]);if(send==='throw')throw Error('secret signed bytes');return send==='wrong'?'unexpected':f.signed.signature;}
  throw Error('Unexpected method');
 }};
 const adapter=new FixedSolanaAdapter({message:f.message,minimumSlot:100,rpc,async sign(message,context){state.signs++;await onSign?.(context);return sign(null,decode64(message,150),f.sender.privateKey);},async beforeSubmit(signature){state.preserved.push(signature);}});
 const controller=new AbortController(),context={signal:controller.signal,deadline:Math.floor(Date.now()/1000)+120,assertActive(){if(controller.signal.aborted)throw new ProtocolError('request_expired');}};
 const cap={chain:CHAIN,account:f.plan.from,methods:['solana_signAndSendTransaction']},request=newRequest(cap,cap.methods[0],{message:f.message});
 return{...f,adapter,cap,request,context,controller,calls,state};
}
test('one exact approval/signature/submission checks state, signed simulation and retained signature',async()=>{
 const f=adapterFixture();let approvals=0;
 const authorizer=new WalletAuthorizer([f.cap],new Map([[CHAIN+'/'+f.cap.methods[0],f.adapter]]),async(request,review)=>{approvals++;assert.equal(canonical(request.params),canonical({message:f.message}));return{approved:true,requestDigest:review.requestDigest};});
 try{const result=await authorizer.handle(f.request);assert.equal(result.status,'submitted');assert.deepEqual(Object.keys(result).sort(),['signature','status']);assert.equal(f.adapter.confirmReceipt(f.receipt).feeLamports,'5000');assert.equal(approvals,1);assert.equal(f.state.signs,1);assert.equal(f.state.sends,1);assert.deepEqual(f.calls.filter(c=>c[0]==='simulateTransaction').map(c=>c[1][1].sigVerify),[false,false,true]);await assert.rejects(()=>authorizer.handle(f.request));}finally{authorizer.close();}
});
test('ambiguous submission retains signature and never retries or signs a replacement',async()=>{
 for(const send of ['throw','wrong']){const f=adapterFixture({send});await f.adapter.review(f.request,f.context);const result=await f.adapter.execute(f.request,f.context);assert.equal(result.status,'broadcast_unknown');assert.equal(result.signature,f.signed.signature);await assert.rejects(()=>f.adapter.execute(f.request,f.context));assert.equal(f.state.signs,1);assert.equal(f.state.sends,1);}
});
test('cancellation during asynchronous signing prevents later dispatch',async()=>{
 let f;f=adapterFixture({onSign:async()=>{f.controller.abort();}});await f.adapter.review(f.request,f.context);await assert.rejects(()=>f.adapter.execute(f.request,f.context),{code:'request_expired'});assert.equal(f.state.signs,1);assert.equal(f.state.sends,0);assert.deepEqual(f.state.preserved,[]);
});
test('wrong network, expired blockhash, unsafe fee and simulation failure never reach signing',async()=>{
 const cases=[['getGenesisHash','mainnet'],['isBlockhashValid',{context:{slot:100},value:false}],['getFeeForMessage',{context:{slot:100},value:10001}],['getMinimumBalanceForRentExemption',1000001],['simulateTransaction',{context:{slot:100},value:{err:{InstructionError:[0,1]}}}]];
 for(const [method,result] of cases){const f=adapterFixture({override:m=>m===method?result:undefined});await assert.rejects(()=>f.adapter.review(f.request,f.context));assert.equal(f.state.signs,0);assert.equal(f.state.sends,0);}
});
