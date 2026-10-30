import {test} from 'node:test';
import assert from 'node:assert/strict';
import {canonical, digest} from '@oathconnect/protocol';
import {newRequest, WalletAuthorizer, type WalletAdapter} from '@oathconnect/sdk';

const cap = {chain: 'eip155:11155111', account: '0x1234', methods: ['eth_sendTransaction']};
test('immutable request and matching digest approval are required before execution', async () => {
  let executed = 0;
  const adapter: WalletAdapter = {review: async r => {assert.equal(Object.isFrozen(r.params), true); return {requestDigest: await digest(canonical(r)), summary: 'Test-only transaction review', warnings: []};}, execute: async () => {executed++; return {hash: 'test'};}};
  const a = new WalletAuthorizer([cap], new Map([[`${cap.chain}/eth_sendTransaction`, adapter]]), async (_, r) => ({approved: true, requestDigest: r.requestDigest}));
  const request = newRequest(cap, 'eth_sendTransaction', {value: '1'});
  assert.deepEqual(await a.handle(request), {hash: 'test'}); assert.equal(executed, 1);
  await assert.rejects(a.handle(request), /duplicate_or_exhausted_request/);
  await assert.rejects(a.handle({...request, chain: 'eip155:1'}), /unauthorized_request/);
  await assert.rejects(a.handle({...request, account: '0xother'}), /unauthorized_request/);
  await assert.rejects(a.handle({...request, method: 'eth_sign'}), /unauthorized_request/);
});
test('rejection, mismatched approval, shutdown during prompt and unknown adapter never execute', async () => {
  let executed = 0;
  const adapter: WalletAdapter = {review: async r => ({requestDigest: await digest(canonical(r)), summary: 'test', warnings: []}), execute: async () => {executed++; return null;}};
  for (const approval of [{approved: false, requestDigest: ''}, {approved: true, requestDigest: 'wrong'}]) {
    const a = new WalletAuthorizer([cap], new Map([[`${cap.chain}/eth_sendTransaction`, adapter]]), async () => approval);
    await assert.rejects(a.handle(newRequest(cap, 'eth_sendTransaction', {})), /user_rejected/);
  }
  const a = new WalletAuthorizer([cap], new Map([[`${cap.chain}/eth_sendTransaction`, adapter]]), async (_, r) => {a.close(); return {approved: true, requestDigest: r.requestDigest};});
  await assert.rejects(a.handle(newRequest(cap, 'eth_sendTransaction', {})), /request_expired/); assert.equal(executed, 0);
});

test('request IDs use canonical 16-byte encoding and size limits count UTF-8 bytes', async () => {
  const {validateRequest} = await import('@oathconnect/sdk');
  const request = newRequest(cap, 'eth_sendTransaction', {});
  assert.throws(()=>validateRequest({...request,id:'A'.repeat(21)+'B'},[cap]),/invalid_base64/);
  assert.throws(()=>newRequest(cap,'eth_sendTransaction',{text:'€'.repeat(8000)}),/message_too_large/);
});
