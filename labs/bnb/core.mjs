// Fixed BNB Smart Chain testnet fixture. Never accepts a caller-selected network,
// endpoint, destination, amount or fee policy. This is not a new production adapter.
import {getAddress} from 'ethers';
import {ProtocolError} from '@oathconnect/protocol';
export const NETWORK=Object.freeze({chain:'eip155:97',chainId:'97',chainHex:'0x61',name:'BNB Smart Chain testnet',endpoint:'https://bsc-testnet-dataseed.bnbchain.org',genesis:'0x6d3c66c5357ec91d5c43af47e234a939b22557cbb552dc45bebbceeed90fbe34'});
// Public test sink address, already funded on this testnet. No existing user wallet is used.
export const RECIPIENT=getAddress('0x00000000000000000000000000000000deadbeef');
export const GAS=21000n,PRICE=1000000000n,VALUE=1n;
export const check=(condition,code)=>{if(!condition)throw new ProtocolError(code);};
export function quantity(value){check(typeof value==='string'&&/^0x(0|[1-9a-f][0-9a-f]{0,63})$/.test(value),'bnb_invalid_quantity');return BigInt(value);}
const hash=value=>typeof value==='string'&&/^0x[0-9a-f]{64}$/.test(value);
const sameAddress=(a,b)=>typeof a==='string'&&/^0x[0-9a-fA-F]{40}$/.test(a)&&a.toLowerCase()===b.toLowerCase();
export function policyFor(account){return {chainId:NETWORK.chainId,genesisHash:NETWORK.genesis,account:getAddress(account),nativeSymbol:'TBNB',feeModel:'gas-limit-times-price',maximumGas:GAS.toString(),maximumFeePerGas:PRICE.toString(),maximumGasFee:(GAS*PRICE).toString(),maximumValue:VALUE.toString(),maximumBlockAge:120,tokens:[]};}
export function paramsFor(account){return [{type:'0x0',chainId:NETWORK.chainHex,from:getAddress(account),to:RECIPIENT,nonce:'0x0',gas:'0x5208',value:'0x1',data:'0x',gasPrice:'0x3b9aca00'}];}
export async function verifyNetwork(rpc,signal){
 const [chain,first]=await Promise.all([rpc.request('eth_chainId',[],signal),rpc.request('eth_getBlockByNumber',['0x0',false],signal)]);
 check(chain===NETWORK.chainHex&&first?.number==='0x0'&&first.hash===NETWORK.genesis,'bnb_network_mismatch');
}
export async function balanceSnapshot(rpc,account,signal){
 const block=await rpc.request('eth_getBlockByNumber',['latest',false],signal);
 quantity(block?.number);check(hash(block?.hash),'bnb_invalid_block');
 const at={blockHash:block.hash,requireCanonical:true};
 const [sender,recipient,nonce,code]=await Promise.all([rpc.request('eth_getBalance',[account,at],signal),rpc.request('eth_getBalance',[RECIPIENT,at],signal),rpc.request('eth_getTransactionCount',[account,'pending'],signal),rpc.request('eth_getCode',[RECIPIENT,at],signal)]);
 check(nonce==='0x0'&&quantity(sender)>=GAS*PRICE+VALUE&&quantity(recipient)>0n&&code==='0x','bnb_fixed_policy_unavailable');
 return {blockNumber:block.number,blockHash:block.hash,senderBalance:sender,recipientBalance:recipient};
}
export function verifyReceipt(receipt,expected){
 check(hash(expected?.hash)&&sameAddress(expected?.sender,expected.sender)&&expected.sender.toLowerCase()!==RECIPIENT.toLowerCase(),'bnb_invalid_expectation');
 check(hash(expected.before?.blockHash),'bnb_invalid_expectation');
 quantity(expected.before.senderBalance);quantity(expected.before.recipientBalance);
 check(receipt?.status==='0x1'&&receipt.type==='0x0'&&receipt.transactionHash===expected.hash&&sameAddress(receipt.from,expected.sender)&&sameAddress(receipt.to,RECIPIENT)&&receipt.contractAddress===null,'bnb_receipt_mismatch');
 check(quantity(receipt.gasUsed)===GAS&&quantity(receipt.effectiveGasPrice)===PRICE&&Array.isArray(receipt.logs)&&receipt.logs.length===0,'bnb_receipt_effect_mismatch');
 check(hash(receipt.blockHash)&&quantity(receipt.blockNumber)>quantity(expected.before.blockNumber),'bnb_receipt_block_mismatch');
 quantity(receipt.transactionIndex);
 return {block:quantity(receipt.blockNumber).toString(),blockHash:receipt.blockHash,gasUsed:GAS.toString(),effectiveGasPrice:PRICE.toString()};
}
export async function confirmReceipt(rpc,receipt,expected,signal){
 const result=verifyReceipt(receipt,expected);
 await verifyNetwork(rpc,signal);
 const at={blockHash:receipt.blockHash,requireCanonical:true};
 const [block,beforeBlock,sender,recipient,finalized]=await Promise.all([
  rpc.request('eth_getBlockByNumber',[receipt.blockNumber,false],signal),rpc.request('eth_getBlockByNumber',[expected.before.blockNumber,false],signal),
  rpc.request('eth_getBalance',[expected.sender,at],signal),rpc.request('eth_getBalance',[RECIPIENT,at],signal),rpc.request('eth_getBlockByNumber',['finalized',false],signal)
 ]);
 check(block?.number===receipt.blockNumber&&block.hash===receipt.blockHash&&beforeBlock?.number===expected.before.blockNumber&&beforeBlock.hash===expected.before.blockHash,'bnb_canonical_block_mismatch');
 check(quantity(expected.before.senderBalance)-quantity(sender)===GAS*PRICE+VALUE&&quantity(recipient)-quantity(expected.before.recipientBalance)===VALUE,'bnb_balance_effect_mismatch');
 check(hash(finalized?.hash)&&quantity(finalized?.number)>=quantity(receipt.blockNumber),'bnb_finality_unconfirmed');
 const finalCanonical=await rpc.request('eth_getBlockByNumber',[finalized.number,false],signal);
 check(finalCanonical?.number===finalized.number&&finalCanonical.hash===finalized.hash&&(finalized.number!==receipt.blockNumber||finalized.hash===receipt.blockHash),'bnb_finality_mismatch');
 await verifyNetwork(rpc,signal);
 return {...result,recipientBalanceIncrease:VALUE.toString(),senderBalanceDecrease:(GAS*PRICE+VALUE).toString(),finalizedHeight:quantity(finalized.number).toString(),finalizedBlockHash:finalized.hash,finality:'Provider-reported finalized height with canonical block and balance checks; not independent consensus proof'};
}
