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

// Public Ed25519 identity/issuer seeds for admission interoperability, never live credentials.
const {createPrivateKey, createPublicKey} = await import('node:crypto');
const {canonical, createProof} = await import('@oathconnect/protocol');
async function edIdentity(n) {
  const der = Buffer.concat([Buffer.from('302e020100300506032b657004220420','hex'), scalar(n)]);
  const priv = createPrivateKey({key: der, format: 'der', type: 'pkcs8'});
  return {privateKey: await crypto.subtle.importKey('pkcs8', der, 'Ed25519', false, ['sign']), publicKey: b64(createPublicKey(priv).export({format: 'der', type: 'spki'}).subarray(-32))};
}
const issuer = await edIdentity(7), client = await edIdentity(6);
const project = {id:'example',name:'Public interoperability fixture',roles:['dapp'],origins:['https://app.example.org'],keys:{one:issuer.publicKey},enabled:true};
const grant = {v:1,project:project.id,kid:'one',audience:relay,session:invitation.session,role:'dapp',origin:project.origins[0],clientKey:client.publicKey,issued:now,expires:now+300,id:b64(Buffer.alloc(16,8))};
const payload = b64(utf8(canonical(grant)));
const token = payload + '.' + b64(new Uint8Array(await crypto.subtle.sign('Ed25519',issuer.privateKey,utf8('OathConnect/grant/v1.'+payload))));
const value = {type:'proposal',capabilities:[{chain:'eip155:11155111',methods:['eth_sendTransaction']}]};
const proof = await createProof(token,client,'ATTEST','/v1/sessions/'+invitation.session,canonical(value),now);
writeFileSync('native/Tests/OathConnectTests/Fixtures/identity.json',JSON.stringify({notice:'PUBLIC TEST-ONLY KEYS. NEVER USE FOR LIVE AUTHENTICATION.',now,relay,session:invitation.session,project,value,clientSeed:b64(scalar(6)),attestation:{origin:grant.origin,grant:token,proof}},null,2)+'\n');
