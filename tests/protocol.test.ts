import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createPairing, joinPairing, parseInvitation, unb64, random, canonical} from '@oathconnect/protocol';

const relay = 'https://relay.example.org';
test('authenticated pairing and bidirectional encryption, secret absent from frames', async () => {
  const p = await createPairing(relay); const w = await joinPairing(p.uri, relay); const d = await p.accept(w.hello);
  const frame = await d.seal({method: 'example', data: 'private plaintext'});
  assert.equal(JSON.stringify(frame).includes('private plaintext'), false);
  assert.equal(JSON.stringify(frame).includes(p.invitation.secret), false);
  assert.deepEqual(await w.channel.open(frame), {data: 'private plaintext', method: 'example'});
  assert.deepEqual(await d.open(await w.channel.seal({ok: true})), {ok: true});
  await assert.rejects(p.accept(w.hello), /already_paired/);
});
test('relay substitution, expired invitation, wrong PSK, changed hello are rejected', async () => {
  const p = await createPairing(relay); const w = await joinPairing(p.uri, relay);
  assert.throws(() => parseInvitation(p.uri, 'https://attacker.example'), /untrusted_relay/);
  assert.throws(() => parseInvitation(p.uri, relay, p.invitation.expires), /invalid_integer/);
  await assert.rejects(p.accept({...w.hello, mac: random()}), /invalid_pairing_mac/);
  await assert.rejects(p.accept({...w.hello, session: random()}), /wrong_session/);
});
test('tampering, replay, gaps, reflection, cross-session and unknown fields are rejected', async () => {
  const p = await createPairing(relay); const w = await joinPairing(p.uri, relay); const d = await p.accept(w.hello);
  const f1 = await d.seal({n: 1}); const f2 = await d.seal({n: 2});
  await assert.rejects(w.channel.open(f2), /replay_or_gap/);
  await assert.rejects(d.open(f1), /wrong_channel/);
  await assert.rejects(w.channel.open({...f1, session: random()}), /wrong_channel/);
  await assert.rejects(w.channel.open({...f1, extra: 1}), /unexpected_fields/);
  await assert.rejects(w.channel.open({...f1, nonce: random(12)}), /authentication_failed/);
  assert.deepEqual(await w.channel.open(f1), {n: 1});
  await assert.rejects(w.channel.open(f1), /replay_or_gap/);
  assert.deepEqual(await w.channel.open(f2), {n: 2});
});
test('concurrent accept allows exactly one peer and concurrent sends stay ordered', async () => {
  const p = await createPairing(relay); const w = await joinPairing(p.uri, relay);
  const accepted = await Promise.allSettled([p.accept(w.hello), p.accept(w.hello)]);
  assert.equal(accepted.filter(r => r.status === 'fulfilled').length, 1);
  const d = accepted.find(r => r.status === 'fulfilled')!;
  if (d.status !== 'fulfilled') throw Error('unreachable');
  const frames = await Promise.all(Array.from({length: 20}, (_, n) => d.value.seal({n})));
  assert.deepEqual(frames.map(f => f.sequence), Array.from({length: 20}, (_, n) => n + 1));
  assert.deepEqual(await Promise.all(frames.map(f => w.channel.open(f))), Array.from({length: 20}, (_, n) => ({n})));
});
test('strict encoding, size, depth and closure', async () => {
  assert.throws(() => unb64('Zg=')); assert.throws(() => unb64('Zh')); assert.throws(() => canonical({x: Number.MAX_SAFE_INTEGER + 1}));
  const p = await createPairing(relay); const w = await joinPairing(p.uri, relay); const d = await p.accept(w.hello);
  assert.throws(() => d.seal({x: 'x'.repeat(25000)}), /message_too_large/);
  d.close(); await assert.rejects(d.seal({x: 1}), /session_closed/);
});

test('queued encryption rechecks the clock and canonical encoding rejects ambiguous Unicode', async () => {
  const p = await createPairing(relay); const w = await joinPairing(p.uri, relay); const d = await p.accept(w.hello);
  const realNow = Date.now;
  try {
    const pending = d.seal({queued: true});
    Date.now = () => d.expires * 1000;
    await assert.rejects(pending, /session_closed/);
  } finally {Date.now = realNow;}
  assert.throws(() => canonical({'é': 1}), /invalid_object_key/);
  assert.throws(() => canonical({label: '\ud800'}), /invalid_unicode/);
  assert.equal(canonical({label: 'שלום 🔐'}), '{"label":"שלום 🔐"}');
});
