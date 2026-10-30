// Fixed BSC testnet qualification. Keys stay in process; no mainnet mode.
import {Wallet, Transaction} from 'ethers';
import {execFileSync} from 'node:child_process';
import {mkdtempSync, writeFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {canonical, createIdentity, createPairing, joinPairing, ProtocolError} from '@oathconnect/protocol';
import {Session, WalletAuthorizer} from '@oathconnect/sdk';
import {EvmAdapter, EvmRpc, EvmRpcError, EvmRpcHttpError} from '@oathconnect/evm';
import {validationRelay} from '../support/relay.mjs';
import {writeEvidence} from '../support/evidence.mjs';

import {NETWORK,RECIPIENT,GAS,PRICE,VALUE,check,quantity,policyFor,paramsFor,verifyNetwork,balanceSnapshot,confirmReceipt} from './core.mjs';
const chain=NETWORK.chain,genesis=NETWORK.genesis,endpoint=NETWORK.endpoint,rpc=new EvmRpc(endpoint),submissionRpc=rpc;
const started=new Date().toISOString(), commit=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
const dirty=execFileSync('git',['status','--porcelain'],{encoding:'utf8'}).trim().length>0;
const evidenceName=process.env.OATHCONNECT_LIVE_VALIDATION==='true'?'bnb-testnet-live':'bnb-testnet';
let stage='network', relay, dapp, wallet, authorizer, fundingDirectory, transactionHash, expectation;
let decisions=0, executions=0, broadcasts=0, adapterFailure, submissionStatus, providerFailure;
const stop=new AbortController();
const onStop=()=>{stop.abort();authorizer?.close();};
process.once('SIGINT',onStop);process.once('SIGTERM',onStop);
const bounded=()=>AbortSignal.any([stop.signal,AbortSignal.timeout(15000)]);
const identity=()=>verifyNetwork(rpc,bounded());
try {
  await identity(); const sender=Wallet.createRandom();
  const recipient=RECIPIENT,policy=policyFor(sender.address);
  stage='free_testnet_funding';
  fundingDirectory=mkdtempSync(join(tmpdir(),'oathconnect-bnb-testnet-'));
  const fundingDeadline=Date.now()+1200000;
  writeFileSync(join(fundingDirectory,'funding.json'),JSON.stringify({network:NETWORK.name,chain,address:sender.address,expires:fundingDeadline})+'\n',{mode:0o600,flag:'wx'});
  console.log(JSON.stringify({stage,address:sender.address,publicFundingFile:join(fundingDirectory,'funding.json'),expiresInSeconds:1200}));
  let funded=false;
  while(Date.now()<fundingDeadline){
    const balance=await rpc.request('eth_getBalance',[sender.address,'latest'],AbortSignal.any([stop.signal,AbortSignal.timeout(Math.max(1,Math.min(15000,fundingDeadline-Date.now())))]));
    if(quantity(balance)>=GAS*PRICE+VALUE){funded=true;break;}
    await delay(Math.max(0,Math.min(5000,fundingDeadline-Date.now())));
  }
  check(funded,'evm_lab_funding_timeout'); await identity();
  stage='pair'; relay=await validationRelay();
  const p=await createPairing(relay.audience),w=await joinPairing(p.uri,relay.audience);
  const dc=relay.client(p.invitation.session,'dapp',await createIdentity()),wc=relay.client(p.invitation.session,'wallet',await createIdentity());
  await dc.create(p.invitation.expires);await wc.join(w.hello);
  dapp=new Session(await p.accept(await dc.hello()),dc,relay.projects);wallet=new Session(w.channel,wc,relay.projects);
  const cap={chain,account:sender.address,methods:['eth_sendTransaction']};
  await Promise.all([dapp.propose([{chain,methods:cap.methods}]),wallet.approveSession(async()=>[cap])]);
  stage='prepare';
  const before=await balanceSnapshot(rpc,sender.address,bounded());
  expectation={sender:sender.address,recipient,before};
  const params=paramsFor(sender.address);
  const adapter=new EvmAdapter(policy,{
    async inspect(plan,signal){
      try{return await rpc.inspect(plan,AbortSignal.any([stop.signal,signal]));}catch(error){
        adapterFailure=error instanceof ProtocolError?error.code:'unclassified';
        if(error instanceof EvmRpcError)providerFailure={method:error.method,code:error.providerCode};
        if(error instanceof EvmRpcHttpError)providerFailure={method:error.method,status:error.status};
        throw error;
      }
    },
    async sign(unsigned,context){
      stage='sign';stop.signal.throwIfAborted();context.assertActive();check(++executions===1,'evm_lab_duplicate_sign');
      return sender.signTransaction(Transaction.from(unsigned));
    },
    async broadcast(signed,signal){
      transactionHash=Transaction.from(signed).hash;
      try{
        stage='submission_network';
        signal=AbortSignal.any([stop.signal,signal]);await verifyNetwork(submissionRpc,signal);signal.throwIfAborted();
        stage='broadcast';check(++broadcasts===1,'evm_lab_duplicate_broadcast');
        // Preserve the public hash before submission so an interrupted run can be reconciled.
        writeEvidence(evidenceName,{started,commit,dirty,chain,network:NETWORK.name,status:'broadcast_pending',hash:transactionHash,transactionConfirmed:false,sender:sender.address,recipient,before,decisions,executions,broadcasts});
        return await submissionRpc.broadcast(signed,signal);
      }catch(error){
        adapterFailure=error instanceof ProtocolError?error.code:'unclassified';
        if(error instanceof EvmRpcError)providerFailure={method:error.method,code:error.providerCode};
        if(error instanceof EvmRpcHttpError)providerFailure={method:error.method,status:error.status};
        throw error;
      }
    }
  });
  authorizer=new WalletAuthorizer([cap],new Map([[chain+'/eth_sendTransaction',adapter]]),async(request,review,context)=>{
    context.assertActive();check(canonical(request.params)===canonical(params),'evm_lab_policy_mismatch');
    decisions++;return{approved:true,requestDigest:review.requestDigest};
  });
  stage='request';const [result]=await Promise.all([dapp.request(cap,'eth_sendTransaction',params),wallet.serveOnce(authorizer)]);
  check(result?.hash===transactionHash&&decisions===1&&executions===1&&broadcasts===1,'evm_lab_result_mismatch');
  submissionStatus=result.status;
  writeEvidence(evidenceName,{started,commit,dirty,chain,network:NETWORK.name,status:'awaiting_receipt',submissionStatus,hash:transactionHash,transactionConfirmed:false,sender:sender.address,recipient,before,decisions,executions,broadcasts,...(adapterFailure?{adapterFailure}:{}),...(providerFailure?{providerFailure}:{})});
  stage='receipt';let receipt;
  // Read-only reconciliation, including an uncertain broadcast; never resubmit.
  for(let attempt=0;attempt<60;attempt++){
    receipt=await rpc.request('eth_getTransactionReceipt',[transactionHash],bounded());
    if(receipt)break;await delay(5000);
  }
  let resultReceipt;
  for(let attempt=0;attempt<12;attempt++){
    try{resultReceipt=await confirmReceipt(rpc,receipt,{hash:transactionHash,sender:sender.address,before},bounded());break;}
    catch(error){if(error?.code!=='bnb_finality_unconfirmed')throw error;if(attempt===11)throw error;await delay(5000);}
  }
  const evidence={started,completed:new Date().toISOString(),commit,dirty,chain,network:NETWORK.name,genesisHash:genesis,rpc:endpoint,transport:relay.description,...(relay.deployedCommit?{deployedCommit:relay.deployedCommit}:{}),status:'confirmed',transactionConfirmed:true,hash:transactionHash,sender:sender.address,recipient,before,...resultReceipt,decisions,executions,broadcasts,submissionStatus:result.status,operation:'One wei testnet BNB transfer to the public test sink address using reusable EvmAdapter',thorchainSwap:false,productionReady:false};
  writeEvidence(evidenceName,evidence);console.log(JSON.stringify(evidence));
} catch(error) {
  const code=error instanceof ProtocolError&&/^[a-z0-9_]{1,100}$/.test(error.code)?error.code:'unclassified';
  const evidence={started,completed:new Date().toISOString(),commit,dirty,network:NETWORK.name,chain,stage,status:stop.signal.aborted?'stopped':'blocked_or_failed',code,...(adapterFailure?{adapterFailure}:{}),...(submissionStatus?{submissionStatus}:{}),...(providerFailure?{providerFailure}:{}),transactionConfirmed:false,...expectation,decisions,executions,broadcasts,...(transactionHash?{hash:transactionHash}:{}),productionReady:false};
  writeEvidence(evidenceName,evidence);console.log(JSON.stringify(evidence));process.exitCode=stop.signal.aborted?130:1;
} finally {
  authorizer?.close();await dapp?.close().catch(()=>{});await wallet?.close().catch(()=>{});await relay?.dispose();
  if(fundingDirectory)rmSync(fundingDirectory,{recursive:true});
  process.removeListener('SIGINT',onStop);process.removeListener('SIGTERM',onStop);
}
