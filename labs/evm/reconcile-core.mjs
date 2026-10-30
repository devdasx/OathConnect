// Read-only Sepolia receipt/finality checks. Provider agreement is not a consensus proof.
import {ProtocolError} from '@oathconnect/protocol';
const hash = value => typeof value==='string' && /^0x[0-9a-f]{64}$/.test(value);
const quantity = value => typeof value==='string' && /^0x(0|[1-9a-f][0-9a-f]{0,63})$/.test(value);
const check = (condition,code) => {if(!condition)throw new ProtocolError(code);};
export async function reconcileReceipt(expected,readers) {
  check(expected?.status==='confirmed' && expected.transactionConfirmed===true && expected.chain==='eip155:11155111' && hash(expected.hash) && hash(expected.blockHash) && typeof expected.block==='string' && /^(0|[1-9][0-9]{0,77})$/.test(expected.block),'evm_reconciliation_invalid_evidence');
  check(Array.isArray(readers)&&readers.length===2&&readers[0].endpoint!==readers[1].endpoint,'evm_reconciliation_invalid_readers');
  const readings=await Promise.all(readers.map(async ({endpoint,rpc})=>{
    const signal=AbortSignal.timeout(15000);
    const [chain,receipt,finalized]=await Promise.all([
      rpc.request('eth_chainId',[],signal),
      rpc.request('eth_getTransactionReceipt',[expected.hash],signal),
      rpc.request('eth_getBlockByNumber',['finalized',false],signal)
    ]);
    check(chain==='0xaa36a7','evm_reconciliation_network_mismatch');
    check(receipt?.status==='0x1' && receipt.transactionHash===expected.hash && receipt.blockHash===expected.blockHash && quantity(receipt.blockNumber) && BigInt(receipt.blockNumber).toString()===expected.block,'evm_reconciliation_receipt_mismatch');
    check(quantity(finalized?.number)&&hash(finalized?.hash),'evm_reconciliation_invalid_finalized_block');
    const block=await rpc.request('eth_getBlockByNumber',[receipt.blockNumber,false],signal);
    check(block?.number===receipt.blockNumber&&block.hash===expected.blockHash,'evm_reconciliation_canonical_mismatch');
    return {endpoint,status:receipt.status,hash:receipt.transactionHash,block:expected.block,canonicalBlockHash:block.hash,finalizedHeight:BigInt(finalized.number).toString(),finalizedBlockHash:finalized.hash,withinReportedFinalizedHeight:BigInt(finalized.number)>=BigInt(receipt.blockNumber)};
  }));
  return {checked:new Date().toISOString(),hash:expected.hash,scope:'Read-only cross-provider receipt/canonical-block and finalized-height checks; RPC assertions, not an independently verified consensus proof',readings,transactionConfirmed:true,finalizedByBothProviders:readings.every(r=>r.withinReportedFinalizedHeight),productionReady:false};
}
