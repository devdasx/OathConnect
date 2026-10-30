// Fixed devnet fixture. Keys and signed bytes stay in memory; no mainnet/key-import option.
import {generateKeyPairSync,sign} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {canonical,createIdentity,createPairing,joinPairing,ProtocolError} from '@oathconnect/protocol';
import {Session,WalletAuthorizer} from '@oathconnect/sdk';
import {validationRelay} from '../support/relay.mjs';
import {writeEvidence} from '../support/evidence.mjs';
import {AMOUNT,MAX_FEE,buildTransfer,check,decode58,decode64,encode58,safeNumber} from './transfer.mjs';
import {SolanaLabRpc,SolanaLabRpcError} from './rpc.mjs';
import {FixedSolanaAdapter} from './adapter.mjs';
import {labNetwork} from './networks.mjs';
const network=labNetwork(process.argv[2]??'devnet'),{chain:CHAIN,genesis:GENESIS}=network;
check(process.argv.length<=3,'solana_lab_invalid_arguments');
const started=new Date().toISOString(),commit=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
const dirty=execFileSync('git',['status','--porcelain'],{encoding:'utf8'}).trim().length>0;
const name='solana-'+network.name+(process.env.OATHCONNECT_LIVE_VALIDATION==='true'?'-live':'');
let stage='network',relay,dapp,wallet,authorizer,fundingDirectory,signature,submissionStatus;
let decisions=0,executions=0,broadcasts=0,providerFailure;
const transport=new SolanaLabRpc(undefined,network.name),rpc={async request(method,params=[],signal){
 try{if(method==='sendTransaction'){check(++broadcasts===1,'solana_duplicate_broadcast');stage='broadcast';}return await transport.request(method,params,signal);}
 catch(error){if(error instanceof SolanaLabRpcError)providerFailure={method:error.method,...(error.status!==undefined?{status:error.status}:{}),...(error.providerCode!==undefined?{code:error.providerCode}:{})};throw error;}
}};
const publicEvidence=extra=>({started,commit,dirty,chain:CHAIN,network:network.label,genesisHash:GENESIS,stage,decisions,executions,broadcasts,...(signature?{signature}:{}),...(submissionStatus?{submissionStatus}:{}),...(providerFailure?{providerFailure}:{}),...(relay?{transport:relay.description,...(relay.deployedCommit?{deployedCommit:relay.deployedCommit}:{})}:{}),thorchainSwap:false,productionReady:false,...extra});
try{
 check(!dirty,'solana_lab_dirty_source');check(await rpc.request('getGenesisHash')===GENESIS,'solana_network_mismatch');
 const sender=generateKeyPairSync('ed25519'),receiver=generateKeyPairSync('ed25519');
 const from=encode58(sender.publicKey.export({format:'der',type:'spki'}).subarray(-32)),to=encode58(receiver.publicKey.export({format:'der',type:'spki'}).subarray(-32));
 stage='free_testnet_funding';fundingDirectory=mkdtempSync(join(tmpdir(),'oathconnect-solana-'));const deadline=Date.now()+1200000;
 writeFileSync(join(fundingDirectory,'funding.json'),JSON.stringify({network:network.label,chain:CHAIN,address:from,expires:deadline})+'\n',{mode:0o600,flag:'wx'});
 console.log(JSON.stringify({stage,address:from,publicFundingFile:join(fundingDirectory,'funding.json'),expiresInSeconds:1200}));
 let funded=false;while(Date.now()<deadline){const result=await rpc.request('getBalance',[from,{commitment:'confirmed'}],AbortSignal.timeout(Math.max(1,Math.min(15000,deadline-Date.now()))));if(safeNumber(result?.value)>=AMOUNT+MAX_FEE){funded=true;break;}await delay(Math.max(0,Math.min(5000,deadline-Date.now())));}
 check(funded,'solana_funding_timeout');check(await rpc.request('getGenesisHash')===GENESIS,'solana_network_mismatch');
 stage='pair';relay=await validationRelay();const p=await createPairing(relay.audience),w=await joinPairing(p.uri,relay.audience);
 const dc=relay.client(p.invitation.session,'dapp',await createIdentity()),wc=relay.client(p.invitation.session,'wallet',await createIdentity());await dc.create(p.invitation.expires);await wc.join(w.hello);
 dapp=new Session(await p.accept(await dc.hello()),dc,relay.projects);wallet=new Session(w.channel,wc,relay.projects);
 const cap={chain:CHAIN,account:from,methods:['solana_signAndSendTransaction']};await Promise.all([dapp.propose([{chain:CHAIN,methods:cap.methods}]),wallet.approveSession(async()=>[cap])]);
 stage='prepare';const latest=await rpc.request('getLatestBlockhash',[{commitment:'confirmed'}]);safeNumber(latest?.context?.slot);safeNumber(latest?.value?.lastValidBlockHeight);decode58(latest.value.blockhash,32);
 const message=buildTransfer(from,to,latest.value.blockhash),params={message};
 const adapter=new FixedSolanaAdapter({networkName:network.name,message,minimumSlot:latest.context.slot,rpc,
  async sign(reviewed,context){context.assertActive();stage='sign';check(++executions===1&&reviewed===message,'solana_duplicate_or_changed_sign');const result=sign(null,decode64(reviewed,150),sender.privateKey);context.assertActive();return result;},
  async beforeSubmit(value){signature=value;writeEvidence(name,publicEvidence({status:'broadcast_pending',transactionConfirmed:false}));}
 });
 authorizer=new WalletAuthorizer([cap],new Map([[CHAIN+'/'+cap.methods[0],adapter]]),async(request,review,context)=>{context.assertActive();check(canonical(request.params)===canonical(params),'solana_test_policy_rejected');check(++decisions===1,'solana_duplicate_approval');return{approved:true,requestDigest:review.requestDigest};});
 stage='request';const [result]=await Promise.all([dapp.request(cap,cap.methods[0],params),wallet.serveOnce(authorizer)]);
 check(result?.signature===signature&&decisions===1&&executions===1&&broadcasts===1,'solana_result_mismatch');submissionStatus=result.status;
 writeEvidence(name,publicEvidence({status:'awaiting_receipt',transactionConfirmed:false}));
 stage='receipt';let receipt;for(let i=0;i<60;i++){receipt=await rpc.request('getTransaction',[signature,{encoding:'base64',commitment:'confirmed',maxSupportedTransactionVersion:0}]);if(receipt)break;await delay(2000);}
 const effects=adapter.confirmReceipt(receipt);check(await rpc.request('getGenesisHash')===GENESIS,'solana_network_mismatch');
 const evidence=publicEvidence({completed:new Date().toISOString(),status:'confirmed',transactionConfirmed:true,...effects,confirmation:'RPC confirmed commitment; finalized commitment not checked',operation:'Fixed 0.001 SOL native transfer on '+network.label+', exact signed bytes and receipt balance effects checked'});writeEvidence(name,evidence);console.log(JSON.stringify(evidence));
}catch(error){const code=error instanceof ProtocolError&&/^[a-z0-9_]{1,100}$/.test(error.code)?error.code:'solana_lab_failed';const evidence=publicEvidence({completed:new Date().toISOString(),status:'blocked_or_failed',transactionConfirmed:false,code});writeEvidence(name,evidence);console.log(JSON.stringify(evidence));process.exitCode=1;}
finally{authorizer?.close();await dapp?.close().catch(()=>{});await wallet?.close().catch(()=>{});await relay?.dispose();if(fundingDirectory)rmSync(fundingDirectory,{recursive:true});}
