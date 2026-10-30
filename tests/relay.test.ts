import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createIdentity, createPairing, joinPairing, random} from '@oathconnect/protocol';
import {fixture} from './support/relay.ts';

test('Cloudflare runtime: pairing, isolated encrypted delivery, ack and close', async () => {
  const f = await fixture();
  try {
    const p = await createPairing(f.audience); const dId = await createIdentity(); const wId = await createIdentity();
    const d = f.client(p.invitation.session, 'dapp', dId); const w = f.client(p.invitation.session, 'wallet', wId);
    await d.create(p.invitation.expires); assert.equal(await d.hello(), null);
    const joined = await joinPairing(p.uri, f.audience); await w.join(joined.hello); const channel = await p.accept(await d.hello());
    await d.send(await channel.seal({private: 'secret'}));
    const frames = await w.receive(0); assert.equal(frames.length, 1); assert.deepEqual(await joined.channel.open(frames[0]), {private: 'secret'});
    await w.acknowledge(1); assert.deepEqual(await w.receive(1), []);
    await assert.rejects(f.client(p.invitation.session, 'wallet', await createIdentity()).receive(0), /relay_rejected/);
    await d.close(); await assert.rejects(w.receive(1), /relay_rejected/);
  } finally {await f.mf.dispose();}
});
test('Cloudflare runtime: replay is atomically rejected, grants cannot read other sessions', async () => {
  const f = await fixture();
  try {
    const p = await createPairing(f.audience); const dId = await createIdentity(); const session = p.invitation.session;
    const created = await f.raw(session, 'dapp', dId, 'PUT', '', {pairExpires: p.invitation.expires}); assert.equal(created.response.status, 200);
    const read = await f.raw(session, 'dapp', dId, 'GET', '/peer'); assert.equal(read.response.status, 200);
    const replay = await f.raw(session, 'dapp', dId, 'GET', '/peer', undefined, read); assert.equal(replay.body.error, 'replayed_proof');
    const other = await f.raw(random(), 'dapp', dId, 'GET', '/peer', undefined, read); assert.equal(other.body.error, 'wrong_session');
    const race = await Promise.all([f.raw(session, 'dapp', dId, 'GET', '/peer'), f.raw(session, 'dapp', dId, 'GET', '/peer')]); assert.ok(race.every(r => r.response.ok));
    const absent = await f.fetcher(f.audience + `/v1/sessions/${session}/peer`); assert.equal(absent.status, 400);
  } finally {await f.mf.dispose();}
});
test('Cloudflare runtime: 32-frame mailbox bound, sequence enforcement and malicious cursor', async () => {
  const f = await fixture();
  try {
    const p = await createPairing(f.audience); const dId = await createIdentity(); const wId = await createIdentity(); const s = p.invitation.session;
    await f.raw(s, 'dapp', dId, 'PUT', '', {pairExpires: p.invitation.expires});
    const joined = await joinPairing(p.uri, f.audience); await f.raw(s, 'wallet', wId, 'PUT', '/peer', joined.hello); const channel = await p.accept(joined.hello);
    const first = await channel.seal({n: 1}); assert.equal((await f.raw(s, 'dapp', dId, 'POST', '/messages', first)).response.status, 200);
    assert.equal((await f.raw(s, 'dapp', dId, 'POST', '/messages', first)).body.error, 'invalid_frame');
    for (let n = 2; n <= 32; n++) assert.equal((await f.raw(s, 'dapp', dId, 'POST', '/messages', await channel.seal({n}))).response.status, 200);
    const extra = await channel.seal({n: 33}); assert.equal((await f.raw(s, 'dapp', dId, 'POST', '/messages', extra)).body.error, 'mailbox_full');
    assert.equal((await f.raw(s, 'wallet', wId, 'DELETE', '/messages?through=9999')).body.error, 'invalid_cursor');
    assert.equal((await f.raw(s, 'wallet', wId, 'DELETE', '/messages?through=32')).response.status, 200);
    assert.equal((await f.raw(s, 'dapp', dId, 'POST', '/messages', extra)).response.status, 200);
  } finally {await f.mf.dispose();}
});
test('global integrator allocation budget stops the 101st session', async () => {
  const f = await fixture();
  try {
    const identity = await createIdentity();
    for (let n = 0; n < 101; n++) {
      const p = await createPairing(f.audience);
      const result = await f.raw(p.invitation.session, 'dapp', identity, 'PUT', '', {pairExpires: p.invitation.expires});
      assert.equal(result.response.status, n < 100 ? 200 : 429);
      if (n === 100) assert.equal(result.body.error, 'project_capacity');
    }
  } finally {await f.mf.dispose();}
});
