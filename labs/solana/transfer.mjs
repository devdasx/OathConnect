// Fixed devnet qualification codec, not a general-purpose Solana wallet adapter.
import {createPublicKey,verify} from 'node:crypto';
import {ProtocolError} from '@oathconnect/protocol';
export const GENESIS='EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG';
export const CHAIN='solana:'+GENESIS.slice(0,32);
export const SYSTEM='11111111111111111111111111111111';
export const AMOUNT=1000000n, MAX_FEE=10000n;
const alphabet='123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
export const check=(condition,code)=>{if(!condition)throw new ProtocolError(code);};
export function encode58(bytes){
 check(bytes instanceof Uint8Array&&bytes.length>0&&bytes.length<=64,'solana_invalid_bytes');
 let n=BigInt('0x'+Buffer.from(bytes).toString('hex')),s='';while(n){s=alphabet[Number(n%58n)]+s;n/=58n;}for(const b of bytes){if(b!==0)break;s='1'+s;}return s;
}
export function decode58(value,size){
 check([32,64].includes(size)&&typeof value==='string'&&/^[1-9A-HJ-NP-Za-km-z]{1,88}$/.test(value),'solana_invalid_encoding');
 let n=0n;for(const c of value)n=n*58n+BigInt(alphabet.indexOf(c));let hex=n.toString(16);if(hex.length%2)hex='0'+hex;
 const zeros=value.match(/^1*/)[0].length,b=Buffer.concat([Buffer.alloc(zeros),n===0n?Buffer.alloc(0):Buffer.from(hex,'hex')]);
 check(b.length===size&&encode58(b)===value,'solana_invalid_encoding');return b;
}
export function decode64(value,size){
 check(typeof value==='string'&&value.length===4*Math.ceil(size/3)&&/^[A-Za-z0-9+/]*={0,2}$/.test(value),'solana_invalid_encoding');const b=Buffer.from(value,'base64');check(b.length===size&&b.toString('base64')===value,'solana_invalid_encoding');return b;
}
export function safeNumber(value){check(Number.isSafeInteger(value)&&value>=0,'solana_invalid_integer');return BigInt(value);}
export function buildTransfer(from,to,blockhash){
 const f=decode58(from,32),t=decode58(to,32),b=decode58(blockhash,32);
 check(from!==to&&from!==SYSTEM&&to!==SYSTEM&&blockhash!==SYSTEM,'solana_invalid_account');
 const instruction=Buffer.alloc(12);instruction.writeUInt32LE(2,0);instruction.writeBigUInt64LE(AMOUNT,4);
 return Buffer.concat([Buffer.from([1,0,1,3]),f,t,Buffer.alloc(32),b,Buffer.from([1,2,2,0,1,12]),instruction]).toString('base64');
}
export function decodeTransfer(message){
 const b=decode64(message,150);
 check(b.subarray(0,4).equals(Buffer.from([1,0,1,3]))&&b.subarray(68,100).equals(Buffer.alloc(32))&&b.subarray(132,138).equals(Buffer.from([1,2,2,0,1,12]))&&b.readUInt32LE(138)===2,'solana_unsupported_message');
 const from=encode58(b.subarray(4,36)),to=encode58(b.subarray(36,68)),blockhash=encode58(b.subarray(100,132));
 check(b.readBigUInt64LE(142)===AMOUNT&&buildTransfer(from,to,blockhash)===message,'solana_transfer_policy');
 return Object.freeze({from,to,blockhash,message,amountLamports:AMOUNT.toString()});
}
export function verifiedWire(message,signature){
 const plan=decodeTransfer(message);check(signature instanceof Uint8Array&&signature.length===64,'solana_invalid_signature');
 try {
  const key=createPublicKey({key:Buffer.concat([Buffer.from('302a300506032b6570032100','hex'),decode58(plan.from,32)]),format:'der',type:'spki'});
  check(verify(null,decode64(message,150),key,signature),'solana_invalid_signature');
 } catch {throw new ProtocolError('solana_invalid_signature');}
 return Object.freeze({signature:encode58(signature),wire:Buffer.concat([Buffer.from([1]),Buffer.from(signature),decode64(message,150)]).toString('base64')});
}
export function inspectAccounts(response,plan,minimumSlot){
 check(response&&safeNumber(response.context?.slot)>=BigInt(minimumSlot)&&Array.isArray(response.value)&&response.value.length===2,'solana_invalid_accounts');
 const [sender,recipient]=response.value;
 check(sender?.owner===SYSTEM&&sender.executable===false&&Array.isArray(sender.data)&&sender.data.length===2&&sender.data[0]===''&&sender.data[1]==='base64','solana_sender_not_plain_account');
 check(safeNumber(sender.lamports)>=AMOUNT+MAX_FEE,'solana_insufficient_balance');
 // Receiver is a freshly generated disposable account; any unexpected state fails closed.
 check(recipient===null&&plan.from!==plan.to,'solana_unexpected_recipient');return response.context.slot;
}
export function verifyReceipt(receipt,signed){
 check(receipt&&receipt.version==='legacy'&&safeNumber(receipt.slot)>0n&&receipt.meta?.err===null,'solana_receipt_unconfirmed');
 check(Array.isArray(receipt.transaction)&&receipt.transaction.length===2&&receipt.transaction[1]==='base64'&&receipt.transaction[0]===signed.wire,'solana_receipt_bytes_changed');
 const wire=decode64(signed.wire,215);check(wire[0]===1&&encode58(wire.subarray(1,65))===signed.signature,'solana_receipt_signature_changed');
 verifiedWire(wire.subarray(65).toString('base64'),wire.subarray(1,65));
 const {fee,preBalances:pre,postBalances:post,innerInstructions:inner}=receipt.meta;
 const f=safeNumber(fee);check(f<=MAX_FEE&&Array.isArray(pre)&&Array.isArray(post)&&pre.length===3&&post.length===3&&(inner===null||Array.isArray(inner)&&inner.length===0),'solana_receipt_effects_mismatch');
 const a=pre.map(safeNumber),b=post.map(safeNumber);
 check(a[1]===0n&&b[1]===AMOUNT&&a[0]-b[0]===AMOUNT+f&&a[2]===b[2],'solana_receipt_balance_mismatch');
 return {slot:receipt.slot,feeLamports:f.toString(),recipientBalanceIncrease:AMOUNT.toString()};
}
