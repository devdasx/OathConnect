// A single fixed Solana devnet transfer fixture, not a general-purpose transaction adapter.
// No wallet keys are exported. Node's Ed25519 implementation performs all signing.
import {generateKeyPairSync,sign} from 'node:crypto';
import {writeFileSync} from 'node:fs';
import {canonical,createIdentity,createPairing,digest,joinPairing} from '@oathconnect/protocol';
import {Session,WalletAuthorizer} from '@oathconnect/sdk';
import {validationRelay} from '../support/relay.mjs';
const alphabet='123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const encode58 = bytes => {let n=BigInt('0x'+Buffer.from(bytes).toString('hex')),s='';while(n){s=alphabet[Number(n%58n)]+s;n/=58n;}for(const b of bytes){if(b!==0)break;s='1'+s;}return s;};
const decode58 = s => {if(!/^[1-9A-HJ-NP-Za-km-z]{1,88}$/.test(s))throw Error('invalid_encoding');let n=0n;for(const c of s)n=n*58n+BigInt(alphabet.indexOf(c));let hex=n.toString(16);if(hex.length%2)hex='0'+hex;const zeros=s.match(/^1*/)[0].length;return Buffer.concat([Buffer.alloc(zeros),n===0n?Buffer.alloc(0):Buffer.from(hex,'hex')]);};
const endpoint='https://api.devnet.solana.com',genesis='EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG',chain='solana:'+genesis.slice(0,32);
async function rpc(method,params=[]){const r=await fetch(endpoint,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params}),redirect:'error',signal:AbortSignal.timeout(15000)});if(!r.ok)throw Error('http_'+r.status);const raw=await r.text();if(raw.length>65536)throw Error('response_size');const v=JSON.parse(raw);if(v.error)throw Error('rpc_'+String(v.error.code).replace('-','minus'));return v.result;}
async function confirmed(signature){for(let n=0;n<30;n++){const status=(await rpc('getSignatureStatuses',[[signature],{searchTransactionHistory:true}])).value[0];if(status?.err)throw Error('transaction_failed');if(['confirmed','finalized'].includes(status?.confirmationStatus))return status;await new Promise(r=>setTimeout(r,2000));}throw Error('confirmation_unknown');}
let stage='network',relay,dapp,wallet;
const started=new Date().toISOString();
try{
 if(await rpc('getGenesisHash')!==genesis)throw Error('network_mismatch');
 const sender=generateKeyPairSync('ed25519'),receiver=generateKeyPairSync('ed25519');
 const from=sender.publicKey.export({type:'spki',format:'der'}).subarray(-32),to=receiver.publicKey.export({type:'spki',format:'der'}).subarray(-32),account=encode58(from);
 stage='free_testnet_funding';await confirmed(await rpc('requestAirdrop',[account,100000000,{commitment:'confirmed'}]));
 stage='pair';relay=await validationRelay();const p=await createPairing(relay.audience),w=await joinPairing(p.uri,relay.audience);
 const dc=relay.client(p.invitation.session,'dapp',await createIdentity()),wc=relay.client(p.invitation.session,'wallet',await createIdentity());await dc.create(p.invitation.expires);await wc.join(w.hello);
 dapp=new Session(await p.accept(await dc.hello()),dc,relay.projects);wallet=new Session(w.channel,wc,relay.projects);
 const cap={chain,account,methods:['solana_signAndSendTransaction']};await Promise.all([dapp.propose([{chain,methods:cap.methods}]),wallet.approveSession(async()=>[cap])]);
 stage='prepare';const recent=(await rpc('getLatestBlockhash',[{commitment:'confirmed'}])).value;const blockhash=decode58(recent.blockhash);if(blockhash.length!==32)throw Error('blockhash_size');
 const instruction=Buffer.alloc(12);instruction.writeUInt32LE(2,0);instruction.writeBigUInt64LE(1000000n,4);
 // Legacy message: one signer, three accounts, one SystemProgram transfer, no address tables.
 const message=Buffer.concat([Buffer.from([1,0,1,3]),from,to,Buffer.alloc(32),blockhash,Buffer.from([1,2,2,0,1,12]),instruction]);
 const params={message:message.toString('base64')},expected=canonical(params);const fee=(await rpc('getFeeForMessage',[params.message,{commitment:'confirmed'}])).value;if(!Number.isSafeInteger(fee)||fee<0||fee>10000)throw Error('fee_rejected');
 let decisions=0,executions=0;
 const authorizer=new WalletAuthorizer([cap],new Map([[chain+'/'+cap.methods[0],{
  async review(request){if(request.chain!==chain||request.account!==account||canonical(request.params)!==expected)throw Error('test_policy_rejected');return{requestDigest:await digest(canonical(request)),summary:'Transfer exactly 0.001 devnet SOL to a disposable account, with at most 0.00001 SOL network fee.',warnings:['Fixed test-only fixture; not a general-purpose Solana adapter.']};},
  async execute(request,context){context.assertActive();if(++executions!==1||canonical(request.params)!==expected||await rpc('getGenesisHash')!==genesis)throw Error('test_policy_rejected');context.assertActive();const signature=sign(null,message,sender.privateKey);const wire=Buffer.concat([Buffer.from([1]),signature,message]);context.assertActive();const hash=await rpc('sendTransaction',[wire.toString('base64'),{encoding:'base64',skipPreflight:false,preflightCommitment:'confirmed',maxRetries:0}]);if(hash!==encode58(signature))throw Error('signature_mismatch');const status=await confirmed(hash);return{hash,slot:status.slot,confirmation:status.confirmationStatus};}
 }]]),async(_,review)=>{decisions++;return{approved:true,requestDigest:review.requestDigest};});
 stage='sign_and_confirm';const [result]=await Promise.all([dapp.request(cap,cap.methods[0],params),wallet.serveOnce(authorizer)]);
 const evidence={started,completed:new Date().toISOString(),network:'Solana devnet',chain,status:'confirmed',transport:relay.description,...(relay.deployedCommit?{deployedCommit:relay.deployedCommit}:{}),...result,decisions,executions,thorchainSwap:false};writeFileSync('evidence/solana-devnet.json',JSON.stringify(evidence,null,2)+'\n');console.log(JSON.stringify(evidence));
}catch(e){const code=/^[a-z0-9_]{1,80}$/.test(e.message)?e.message:'unclassified';const evidence={started,completed:new Date().toISOString(),network:'Solana devnet',chain,stage,status:'blocked_or_failed',transactionConfirmed:false,code,thorchainSwap:false};writeFileSync('evidence/solana-devnet.json',JSON.stringify(evidence,null,2)+'\n');console.log(JSON.stringify(evidence));process.exitCode=1;}
finally{await dapp?.close().catch(()=>{});await wallet?.close().catch(()=>{});await relay?.dispose();}
