import {canonical,digest,ProtocolError} from '@oathconnect/protocol';
import {AMOUNT,CHAIN,GENESIS,MAX_FEE,check,decode64,decodeTransfer,inspectAccounts,safeNumber,verifiedWire,verifyReceipt} from './transfer.mjs';

/** One fixed devnet transfer per fixture instance. Not a general-purpose wallet adapter. */
export class FixedSolanaAdapter {
 #plan; #reviewed; #signed; #attempted=false; #busy=false;
 constructor({message,minimumSlot,rpc,sign,beforeSubmit}){
  this.#plan=decodeTransfer(message);safeNumber(minimumSlot);
  this.minimumSlot=minimumSlot;this.rpc=rpc;this.sign=sign;this.beforeSubmit=beforeSubmit;
 }
 #validate(request){
  check(request.chain===CHAIN&&request.account===this.#plan.from&&request.method==='solana_signAndSendTransaction'&&canonical(request.params)===canonical({message:this.#plan.message}),'solana_test_policy_rejected');
 }
 confirmReceipt(receipt){check(this.#signed,'solana_no_signed_transaction');return verifyReceipt(receipt,this.#signed);}
 async #inspect(context,signed){
  context.assertActive();const rpc=(method,params=[])=>this.rpc.request(method,params,context.signal);
  check(await rpc('getGenesisHash')===GENESIS,'solana_network_mismatch');context.assertActive();
  const cfg={commitment:'confirmed',minContextSlot:this.minimumSlot};
  const [accounts,valid,fee,rent]=await Promise.all([
   rpc('getMultipleAccounts',[[this.#plan.from,this.#plan.to],{...cfg,encoding:'base64'}]),
   rpc('isBlockhashValid',[this.#plan.blockhash,cfg]),
   rpc('getFeeForMessage',[this.#plan.message,cfg]),
   rpc('getMinimumBalanceForRentExemption',[0,{commitment:'confirmed'}])
  ]);context.assertActive();
  const slot=inspectAccounts(accounts,this.#plan,this.minimumSlot);
  check(safeNumber(valid?.context?.slot)>=BigInt(this.minimumSlot)&&valid.value===true,'solana_blockhash_expired');
  check(safeNumber(fee?.context?.slot)>=BigInt(this.minimumSlot)&&safeNumber(fee.value)<=MAX_FEE,'solana_fee_rejected');
  check(safeNumber(rent)<=AMOUNT,'solana_recipient_rent_policy');
  const wire=signed?.wire??Buffer.concat([Buffer.from([1]),Buffer.alloc(64),decode64(this.#plan.message,150)]).toString('base64');
  const sim=await rpc('simulateTransaction',[wire,{encoding:'base64',commitment:'confirmed',minContextSlot:Math.max(slot,this.minimumSlot),sigVerify:!!signed,replaceRecentBlockhash:false}]);
  context.assertActive();check(safeNumber(sim?.context?.slot)>=BigInt(Math.max(slot,this.minimumSlot))&&sim.value?.err===null,'solana_simulation_failed');
  check(await rpc('getGenesisHash')===GENESIS,'solana_network_mismatch');context.assertActive();
 }
 async review(request,context){
  context.assertActive();check(!this.#attempted&&!this.#busy,'solana_duplicate_attempt');this.#validate(request);
  const requestDigest=await digest(canonical(request));await this.#inspect(context);context.assertActive();
  check(!this.#attempted&&!this.#busy,'solana_duplicate_attempt');this.#reviewed=requestDigest;
  return {requestDigest,summary:`Send exactly 0.001 devnet SOL from ${this.#plan.from} to disposable account ${this.#plan.to}. Maximum network fee: 0.00001 SOL.`,warnings:['Fixed devnet qualification only; not a general-purpose signing adapter.','RPC state and simulation are provider assertions, not independently verified consensus.']};
 }
 async execute(request,context){
  context.assertActive();this.#validate(request);const requestDigest=await digest(canonical(request));context.assertActive();
  check(!this.#busy&&!this.#attempted&&this.#reviewed===requestDigest,'solana_unreviewed_or_duplicate');this.#busy=true;this.#reviewed=undefined;
  try{
   await this.#inspect(context);context.assertActive();this.#attempted=true;
   let signature;try{signature=await this.sign(this.#plan.message,context);}catch{throw new ProtocolError('solana_signing_failed');}
   context.assertActive();const signed=verifiedWire(this.#plan.message,signature);
   await this.#inspect(context,signed);context.assertActive();this.#signed=signed;
   // Preserve only the public signature before any submission; fail closed if evidence cannot be written.
   await this.beforeSubmit(signed.signature);context.assertActive();
   try{
    const returned=await this.rpc.request('sendTransaction',[signed.wire,{encoding:'base64',skipPreflight:false,preflightCommitment:'confirmed',maxRetries:0,minContextSlot:this.minimumSlot}],context.signal);
    return {signature:signed.signature,status:returned===signed.signature?'submitted':'broadcast_unknown'};
   }catch{return {signature:signed.signature,status:'broadcast_unknown'};}
  }finally{this.#busy=false;}
 }
}
