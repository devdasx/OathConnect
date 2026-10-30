// Independent codec/signature comparison against the pinned Solana Foundation SDK.
// No RPC, blockchain submission, persisted private keys or real funds.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,randomBytes,sign} from 'node:crypto';
import {PublicKey,SystemProgram,Transaction} from '@solana/web3.js';
import {AMOUNT,buildTransfer,decode64,encode58,verifiedWire} from './transfer.mjs';
test('Solana Foundation SDK generates identical transfer bytes and verifies the Node signature',async()=>{
 for(let i=0;i<8;i++){
  const sender=generateKeyPairSync('ed25519'),from=encode58(sender.publicKey.export({format:'der',type:'spki'}).subarray(-32)),to=encode58(randomBytes(32)),blockhash=encode58(randomBytes(32));
  const message=buildTransfer(from,to,blockhash),tx=new Transaction({feePayer:new PublicKey(from),recentBlockhash:blockhash}).add(SystemProgram.transfer({fromPubkey:new PublicKey(from),toPubkey:new PublicKey(to),lamports:AMOUNT}));
  assert.equal(Buffer.from(tx.serializeMessage()).toString('base64'),message);
  const signed=verifiedWire(message,sign(null,decode64(message,150),sender.privateKey));
  const parsed=Transaction.from(decode64(signed.wire,215));assert.equal(await parsed.verifySignatures(),true);assert.equal(Buffer.from(await parsed.serialize()).toString('base64'),signed.wire);
  assert.equal(parsed.instructions.length,1);assert.equal(parsed.instructions[0].programId.toBase58(),SystemProgram.programId.toBase58());
 }
});
