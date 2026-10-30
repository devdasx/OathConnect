// Public deterministic TEST-ONLY connection keys. Never use these in a real session.
import {createECDH} from 'node:crypto';
import {writeFileSync} from 'node:fs';
import {b64, utf8, invitationURI, associatedData} from '@oathconnect/protocol';
const now = 1700000000, relay = 'https://relay.example.org';
const scalar = n => Buffer.alloc(32, n);
async function key(n) {
  const ecdh = createECDH('prime256v1'); ecdh.setPrivateKey(scalar(n)); const pub = ecdh.getPublicKey();
  const privateKey = await crypto.subtle.importKey('jwk', {kty: 'EC', crv: 'P-256', x: b64(pub.subarray(1,33)), y: b64(pub.subarray(33)), d: b64(scalar(n)), ext: true}, {name: 'ECDH', namedCurve: 'P-256'}, true, ['deriveBits']);
  const publicKey = await crypto.subtle.importKey('raw', pub, {name: 'ECDH', namedCurve: 'P-256'}, true, []);
  return {privateKey, publicKey, raw: b64(pub)};
}
const d = await key(1), w = await key(2);
const invitation = {v: 1, session: b64(scalar(4)), relay, expires: now + 300, secret: b64(scalar(3)), publicKey: d.raw};
const transcript = JSON.stringify(['OathConnect/pair/v1', invitation.session, relay, invitation.expires, d.raw, w.raw]);
const hmac = await crypto.subtle.importKey('raw', scalar(3), {name: 'HMAC', hash: 'SHA-256'}, false, ['sign']);
const mac = b64(new Uint8Array(await crypto.subtle.sign('HMAC', hmac, utf8(transcript))));
const shared = await crypto.subtle.deriveBits({name: 'ECDH', public: w.publicKey}, d.privateKey, 256);
const material = await crypto.subtle.importKey('raw', shared, 'HKDF', false, ['deriveKey']);
const plaintext = '{"message":"public interoperability fixture"}';
const frames = {};
for (const sender of ['dapp','wallet']) {
  const k = await crypto.subtle.deriveKey({name: 'HKDF', hash: 'SHA-256', salt: scalar(3), info: utf8(JSON.stringify(['OathConnect/channel/v1', transcript, sender]))}, material, {name: 'AES-GCM', length: 256}, true, ['encrypt']);
  const header = {v: 1, session: invitation.session, sender, sequence: 1, expires: invitation.expires + 3300, nonce: b64(Buffer.alloc(12,5))};
  frames[sender] = {...header, ciphertext: b64(new Uint8Array(await crypto.subtle.encrypt({name:'AES-GCM', iv: Buffer.alloc(12,5), additionalData: associatedData(header), tagLength:128}, k, utf8(plaintext))))};
}
const vector = {notice: 'PUBLIC TEST-ONLY KEYS. NEVER USE FOR LIVE PAIRING.', now, uri: invitationURI(invitation), walletPrivate: b64(scalar(2)), hello: {v:1,session: invitation.session,publicKey:w.raw,mac}, plaintext, frames};
writeFileSync('native/Tests/OathConnectTests/Fixtures/v1.json', JSON.stringify(vector,null,2)+'\n');
