import {check,decode58,decode64,encode58,safeNumber,verifiedWire,verifyReceipt} from './transfer.mjs';
import {labNetwork} from './networks.mjs';

/** Read-only reconciliation of a previously retained public transaction signature. */
export async function reconcileReceipt(expected,rpc,networkName='devnet'){
 const {chain:CHAIN,genesis:GENESIS,endpoint}=labNetwork(networkName);
 check(expected?.chain===CHAIN&&expected.genesisHash===GENESIS,'solana_reconciliation_wrong_network');
 decode58(expected.signature,64);
 if(expected.slot!==undefined)check(safeNumber(expected.slot)>0n,'solana_reconciliation_invalid_slot');
 const signal=AbortSignal.timeout(30000),read=(method,params=[])=>rpc.request(method,params,signal);
 check(await read('getGenesisHash')===GENESIS,'solana_network_mismatch');
 const receipt=await read('getTransaction',[expected.signature,{encoding:'base64',commitment:'finalized',maxSupportedTransactionVersion:0}]);
 check(receipt,'solana_receipt_not_finalized');
 check(Array.isArray(receipt.transaction)&&receipt.transaction.length===2&&receipt.transaction[1]==='base64','solana_receipt_bytes_changed');
 const wire=decode64(receipt.transaction[0],215);
 check(wire[0]===1&&encode58(wire.subarray(1,65))===expected.signature,'solana_receipt_signature_changed');
 const signed=verifiedWire(wire.subarray(65).toString('base64'),wire.subarray(1,65));
 const effects=verifyReceipt(receipt,signed);
 if(expected.slot!==undefined)check(effects.slot===expected.slot,'solana_receipt_slot_changed');
 if(expected.feeLamports!==undefined)check(effects.feeLamports===expected.feeLamports,'solana_receipt_fee_changed');
 const statuses=await read('getSignatureStatuses',[[expected.signature],{searchTransactionHistory:true}]);
 check(safeNumber(statuses?.context?.slot)>=BigInt(effects.slot)&&Array.isArray(statuses.value)&&statuses.value.length===1,'solana_invalid_signature_status');
 const status=statuses.value[0];
 check(status?.slot===effects.slot&&status.err===null&&status.confirmationStatus==='finalized'&&status.confirmations===null,'solana_finality_mismatch');
 check(await read('getGenesisHash')===GENESIS,'solana_network_mismatch');
 return {checked:new Date().toISOString(),chain:CHAIN,genesisHash:GENESIS,signature:expected.signature,...effects,
  status:'finalized',transactionConfirmed:true,finalized:true,signatureVerified:true,provider:endpoint,
  scope:'Provider-reported finalized receipt and signature status agree; signature, fixed message and balance effects verified. Not independent consensus proof.',
  submissions:0,thorchainSwap:false,productionReady:false};
}
