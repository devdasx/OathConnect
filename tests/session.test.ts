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
    const d = new Session(await p.accept(await dc.hello()), dc, f.projects); const w = new Session(joined.channel, wc, f.projects);
    const capability = {chain: 'eip155:11155111', account: '0x1234', methods: ['personal_sign']};
    const approved = await Promise.all([d.propose([{chain: capability.chain, methods: capability.methods}]), w.approveSession(async (requested, peer) => {assert.equal(peer.origin, 'https://app.example.org'); return requested.map(r => ({...r, account: capability.account}));})]);
    assert.deepEqual(approved, [[capability], [capability]]);
    let prompts = 0; let executions = 0;
    const adapter: WalletAdapter = {review: async r => ({requestDigest: await digest(canonical(r)), summary: 'Local fixture: no blockchain transaction', warnings: []}), execute: async () => {executions++; return {fixture: true};}};
    const auth = new WalletAuthorizer([capability], new Map([[`${capability.chain}/personal_sign`, adapter]]), async (_, r) => {prompts++; return {approved: true, requestDigest: r.requestDigest};});
    const [result] = await Promise.all([d.request(capability, 'personal_sign', ['test fixture']), w.serveOnce(auth)]);
    assert.deepEqual(result, {fixture: true}); assert.equal(prompts, 1); assert.equal(executions, 1);
    await d.close();
  } finally {await f.mf.dispose();}
});

async function pairedFixture() {
  const f = await fixture(), p = await createPairing(f.audience), joined = await joinPairing(p.uri, f.audience);
  const dc = f.client(p.invitation.session, 'dapp', await createIdentity()), wc = f.client(p.invitation.session, 'wallet', await createIdentity());
  await dc.create(p.invitation.expires); await wc.join(joined.hello);
  const channel = await p.accept(await dc.hello());
  const d = new Session(channel, dc, f.projects), w = new Session(joined.channel, wc, f.projects);
  const cap = {chain:'eip155:11155111',account:'0x1234',methods:['personal_sign']};
  await Promise.all([d.propose([cap]), w.approveSession(async()=>[cap])]);
  let executions = 0, prompts = 0;
  const makeAuthorizer = () => new WalletAuthorizer([cap], new Map([[cap.chain+'/personal_sign', {
    async review(r) {return {requestDigest:await digest(canonical(r)),summary:'Test-only action',warnings:[]};},
    async execute() {executions++;return null;}
  }]]), async(_,review)=>{prompts++;return {approved:true,requestDigest:review.requestDigest};});
  return {f,dc,wc,d,w,cap,channel,makeAuthorizer,counts:()=>({executions,prompts})};
}

test('closing during the final request acknowledgement prevents approval and execution', async () => {
  const p = await pairedFixture();
  try {
    const ack = p.wc.acknowledge.bind(p.wc);
    p.wc.acknowledge = async through => {const result = await ack(through); if (through === 2) await p.w.close(); return result;};
    const outcomes = await Promise.allSettled([p.d.request(p.cap,'personal_sign',['fixture']),p.w.serveOnce(p.makeAuthorizer())]);
    assert.ok(outcomes.every(r=>r.status==='rejected'));
    assert.deepEqual(p.counts(),{executions:0,prompts:0});
  } finally {await p.f.mf.dispose();}
});

test('request IDs stay consumed when the application replaces its authorizer', async () => {
  const p = await pairedFixture();
  try {
    const {newRequest} = await import('@oathconnect/sdk'); const request = newRequest(p.cap,'personal_sign',['fixture']);
    await p.dc.send(await p.channel.seal(request)); await p.w.serveOnce(p.makeAuthorizer());
    await p.dc.send(await p.channel.seal(request));
    await assert.rejects(p.w.serveOnce(p.makeAuthorizer()),/duplicate_or_exhausted_request/);
    assert.deepEqual(p.counts(),{executions:1,prompts:1});
  } finally {await p.f.mf.dispose();}
});
