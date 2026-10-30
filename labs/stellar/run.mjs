// Testnet-only fixed payment fixture. Secret keys exist only in this process.
import {Keypair,TransactionBuilder,Networks,Operation,Asset,Horizon} from '@stellar/stellar-sdk';
import {mkdirSync,writeFileSync} from 'node:fs';
import {canonical,createIdentity,createPairing,digest,joinPairing,ProtocolError} from '@oathconnect/protocol';
import {Session,WalletAuthorizer} from '@oathconnect/sdk';
import {validationRelay} from '../support/relay.mjs';
const endpoint='https://horizon-testnet.stellar.org',chain='stellar:testnet';
const server=new Horizon.Server(endpoint,{allowHttp:false});
const started=new Date().toISOString();let stage='network',relay,dapp,wallet,transactionHash; let broadcastAttempted=false,adapterFailure;
async function network(){const r=await fetch(endpoint,{redirect:'error',signal:AbortSignal.timeout(15000)});if(!r.ok)throw Error('network_unavailable');const value=await r.json();if(value.network_passphrase!==Networks.TESTNET)throw Error('network_mismatch');}
async function fund(account){const r=await fetch('https://friendbot.stellar.org/?addr='+encodeURIComponent(account),{redirect:'error',signal:AbortSignal.timeout(45000)});if(!r.ok)throw Error('funding_http_'+r.status);await r.body?.cancel();}
try{
 await network();const sender=Keypair.random(),receiver=Keypair.random();stage='free_testnet_funding';await fund(sender.publicKey());await fund(receiver.publicKey());
 stage='pair';relay=await validationRelay();const p=await createPairing(relay.audience),w=await joinPairing(p.uri,relay.audience);
 const dc=relay.client(p.invitation.session,'dapp',await createIdentity()),wc=relay.client(p.invitation.session,'wallet',await createIdentity());await dc.create(p.invitation.expires);await wc.join(w.hello);
 dapp=new Session(await p.accept(await dc.hello()),dc,relay.projects);wallet=new Session(w.channel,wc,relay.projects);
 const cap={chain,account:sender.publicKey(),methods:['stellar_signAndSubmit']};await Promise.all([dapp.propose([{chain,methods:cap.methods}]),wallet.approveSession(async()=>[cap])]);
 stage='prepare';const source=await server.loadAccount(sender.publicKey());
 const prepared=new TransactionBuilder(source,{fee:'100',networkPassphrase:Networks.TESTNET}).addOperation(Operation.payment({destination:receiver.publicKey(),asset:Asset.native(),amount:'0.0000001'})).setTimeout(90).build();
 const expected=prepared.toXDR();let executions=0,decisions=0;
 const authorizer=new WalletAuthorizer([cap],new Map([[chain+'/'+cap.methods[0],{
  async review(request){ stage='review';
   if(request.chain!==chain||request.account!==sender.publicKey()||canonical(request.params)!==canonical({xdr:expected}))throw Error('test_policy_rejected');
   const decoded=TransactionBuilder.fromXDR(request.params.xdr,Networks.TESTNET);const op=decoded.operations[0];
   if(decoded.source!==sender.publicKey()||decoded.fee!=='100'||decoded.signatures.length!==0||decoded.operations.length!==1||op.type!=='payment'||op.destination!==receiver.publicKey()||!op.asset.isNative()||op.amount!=='0.0000001'||decoded.memo.type!=='none')throw Error('transaction_review_rejected');
   return{requestDigest:await digest(canonical(request)),summary:'Send exactly one testnet stroop (0.0000001 XLM) to a newly generated disposable account, with a 100-stroop fee.',warnings:['Fixed testnet fixture, not a general-purpose Stellar signing adapter.']};
  },
  async execute(request){
   stage='sign';
   if(++executions!==1||canonical(request.params)!==canonical({xdr:expected}))throw Error('test_policy_rejected');await network();
   const transaction=TransactionBuilder.fromXDR(request.params.xdr,Networks.TESTNET);transaction.sign(sender);const hash=Buffer.from(transaction.hash()).toString('hex'); transactionHash=hash;
   stage='submit'; broadcastAttempted=true;
   let submitted; try {submitted=await server.submitTransaction(transaction,{skipMemoRequiredCheck:true});} catch(error) {adapterFailure={name:error?.constructor?.name,status:error?.response?.status,transactionCode:error?.response?.data?.extras?.result_codes?.transaction};throw error;}if(submitted.hash!==hash||submitted.successful!==true)throw Error('submission_not_confirmed');
   stage='receipt'; const receipt=await server.transactions().transaction(hash).call();if(receipt.hash!==hash||receipt.successful!==true||receipt.operation_count!==1||receipt.source_account!==sender.publicKey())throw Error('receipt_mismatch');
   stage='operations'; const operations=await server.operations().forTransaction(hash).call();const payment=operations.records[0];
   if(operations.records.length!==1||payment.type!=='payment'||payment.to!==receiver.publicKey()||payment.amount!=='0.0000001'||payment.asset_type!=='native')throw Error('payment_mismatch');
   const ledger=receipt.ledger_attr;if(!Number.isSafeInteger(ledger)||ledger<=0)throw Error('invalid_receipt');
   return{hash,ledger};
  }
 }]]),async(_,review)=>{decisions++;return{approved:true,requestDigest:review.requestDigest};});
 stage='sign_and_confirm';const [result]=await Promise.all([dapp.request(cap,cap.methods[0],{xdr:expected}),wallet.serveOnce(authorizer)]);
 if(!/^[a-f0-9]{64}$/.test(result.hash)||!Number.isSafeInteger(result.ledger)||result.ledger<=0||decisions!==1||executions!==1)throw Error('invalid_receipt');
 const evidence={started,completed:new Date().toISOString(),network:'Stellar Testnet',chain,transport:relay.description,status:'confirmed',hash:result.hash,ledger:result.ledger,decisions,executions,operation:'Payment of one stroop between disposable funded accounts',thorchainSwap:false};
 mkdirSync('evidence',{recursive:true});writeFileSync('evidence/stellar-testnet.json',JSON.stringify(evidence,null,2)+'\n');console.log(JSON.stringify(evidence));
}catch(error){const own=error instanceof ProtocolError?error.code:error?.message;const code=/^(network_|funding_http_|test_policy_|transaction_review_|submission_|receipt_|payment_|invalid_receipt)[a-z0-9_]*$/.test(own)?own:'unclassified';const evidence={started,completed:new Date().toISOString(),network:'Stellar Testnet',chain,stage,status:'blocked_or_failed',transactionConfirmed:false,broadcastAttempted,...(transactionHash?{hash:transactionHash}:{}),code,...(adapterFailure?{provider:{name:/^[A-Za-z0-9_]{1,80}$/.test(adapterFailure.name)?adapterFailure.name:'unknown',status:Number.isInteger(adapterFailure.status)?adapterFailure.status:null,transactionCode:/^[a-z_0-9]{1,80}$/.test(adapterFailure.transactionCode)?adapterFailure.transactionCode:null}}:{})};mkdirSync('evidence',{recursive:true});writeFileSync('evidence/stellar-testnet.json',JSON.stringify(evidence,null,2)+'\n');console.log(JSON.stringify(evidence));process.exitCode=1;}
finally{await dapp?.close().catch(()=>{});await wallet?.close().catch(()=>{});await relay?.dispose();}
