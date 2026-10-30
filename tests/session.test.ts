import {test} from 'node:test';
import assert from 'node:assert/strict';
import {canonical, createIdentity, createPairing, digest, joinPairing} from '@oathconnect/protocol';
import {Session, WalletAuthorizer, type WalletAdapter} from '@oathconnect/sdk';
import {fixture} from './support/relay.ts';

test('end-to-end SDK negotiation and user-approved request through Cloudflare runtime', async () => {
  const f = await fixture();
  try {
    const p = await createPairing(f.audience); const joined = await joinPairing(p.uri, f.audience);
    const dc = f.client(p.invitation.session, 'dapp', await createIdentity()); const wc = f.client(p.invitation.session, 'wallet', await createIdentity());
    await dc.create(p.invitation.expires); await wc.join(joined.hello);
    const d = new Session(await p.accept(await dc.hello()), dc); const w = new Session(joined.channel, wc);
    const capability = {chain: 'eip155:11155111', account: '0x1234', methods: ['personal_sign']};
    const approved = await Promise.all([d.propose([capability]), w.approveSession(async requested => requested)]);
    assert.deepEqual(approved, [[capability], [capability]]);
    let prompts = 0; let executions = 0;
    const adapter: WalletAdapter = {review: async r => ({requestDigest: await digest(canonical(r)), summary: 'Local fixture: no blockchain transaction', warnings: []}), execute: async () => {executions++; return {fixture: true};}};
    const auth = new WalletAuthorizer([capability], new Map([[`${capability.chain}/personal_sign`, adapter]]), async (_, r) => {prompts++; return {approved: true, requestDigest: r.requestDigest};});
    const [result] = await Promise.all([d.request(capability, 'personal_sign', ['test fixture']), w.serveOnce(auth)]);
    assert.deepEqual(result, {fixture: true}); assert.equal(prompts, 1); assert.equal(executions, 1);
    await d.close();
  } finally {await f.mf.dispose();}
});
