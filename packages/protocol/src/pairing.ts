import {b64, fixed, integer, nowSeconds, parseJSON, random, record, relayOrigin, requireThat, unb64, utf8, type Role} from './codec.js';
import {SecureChannel} from './channel.js';

export interface Invitation {v: 1; session: string; relay: string; expires: number; secret: string; publicKey: string}
export interface Hello {v: 1; session: string; publicKey: string; mac: string}
const invitationFields = ['v', 'session', 'relay', 'expires', 'secret', 'publicKey'];
export function validateInvitation(value: unknown, trustedRelay: string, now = nowSeconds()): Invitation {
  record(value, invitationFields);
  requireThat(value.v === 1, 'unsupported_version'); fixed(value.session, 32); fixed(value.secret, 32); fixed(value.publicKey, 65);
  requireThat(relayOrigin(value.relay) === relayOrigin(trustedRelay), 'untrusted_relay');
  integer(value.expires, now + 1, now + 300);
  return value as unknown as Invitation;
}
export function invitationURI(invitation: Invitation): string {
  return `oathconnect://pair#${b64(utf8(JSON.stringify(invitation)))}`;
}
export function parseInvitation(uri: string, trustedRelay: string, now = nowSeconds()): Invitation {
  requireThat(uri.startsWith('oathconnect://pair#') && uri.length <= 2048, 'invalid_invitation');
  const raw = new TextDecoder('utf-8', {fatal: true}).decode(unb64(uri.slice('oathconnect://pair#'.length), 1400));
  return validateInvitation(parseJSON(raw, 1400), trustedRelay, now);
}
async function keypair() {
  return crypto.subtle.generateKey({name: 'ECDH', namedCurve: 'P-256'}, false, ['deriveBits']);
}
const publicKey = async (key: CryptoKey) => b64(new Uint8Array(await crypto.subtle.exportKey('raw', key)));
const transcript = (i: Invitation, wallet: string) => JSON.stringify(['OathConnect/pair/v1', i.session, i.relay, i.expires, i.publicKey, wallet]);
const hmacKey = (secret: string) => crypto.subtle.importKey('raw', unb64(secret, 32), {name: 'HMAC', hash: 'SHA-256'}, false, ['sign', 'verify']);
async function derive(i: Invitation, privateKey: CryptoKey, peer: string, walletPublic: string, localRole: Role): Promise<SecureChannel> {
  const imported = await crypto.subtle.importKey('raw', unb64(peer, 65), {name: 'ECDH', namedCurve: 'P-256'}, false, []);
  const shared = await crypto.subtle.deriveBits({name: 'ECDH', public: imported}, privateKey, 256);
  const hkdf = await crypto.subtle.importKey('raw', shared, 'HKDF', false, ['deriveKey']);
  const keys = await Promise.all((['dapp', 'wallet'] as const).map(sender => crypto.subtle.deriveKey({
    name: 'HKDF', hash: 'SHA-256', salt: unb64(i.secret, 32),
    info: utf8(JSON.stringify(['OathConnect/channel/v1', transcript(i, walletPublic), sender]))
  }, hkdf, {name: 'AES-GCM', length: 256}, false, ['encrypt', 'decrypt'])));
  new Uint8Array(shared).fill(0);
  return new SecureChannel(i.session, localRole, keys[localRole === 'dapp' ? 0 : 1]!, keys[localRole === 'dapp' ? 1 : 0]!, i.expires + 3300);
}

export async function createPairing(relay: string, now = nowSeconds()) {
  const keys = await keypair();
  const invitation: Invitation = {v: 1, session: random(), relay: relayOrigin(relay), expires: now + 300, secret: random(), publicKey: await publicKey(keys.publicKey)};
  let accepted = false;
  return {
    invitation: Object.freeze(invitation), uri: invitationURI(invitation),
    async accept(value: unknown, at = nowSeconds()): Promise<SecureChannel> {
      requireThat(!accepted, 'already_paired');
      validateInvitation(invitation, relay, at);
      record(value, ['v', 'session', 'publicKey', 'mac']);
      requireThat(value.v === 1 && value.session === invitation.session, 'wrong_session');
      fixed(value.publicKey, 65); fixed(value.mac, 32);
      requireThat(await crypto.subtle.verify('HMAC', await hmacKey(invitation.secret), unb64(value.mac, 32), utf8(transcript(invitation, value.publicKey as string))), 'invalid_pairing_mac');
      // Claim before another async operation; concurrent accepts cannot both succeed.
      requireThat(!accepted, 'already_paired'); accepted = true;
      return derive(invitation, keys.privateKey, value.publicKey as string, value.publicKey as string, 'dapp');
    }
  };
}
export async function joinPairing(uri: string, trustedRelay: string, now = nowSeconds()): Promise<{hello: Hello; channel: SecureChannel}> {
  const i = parseInvitation(uri, trustedRelay, now);
  const keys = await keypair(); const wallet = await publicKey(keys.publicKey);
  const mac = b64(new Uint8Array(await crypto.subtle.sign('HMAC', await hmacKey(i.secret), utf8(transcript(i, wallet)))));
  return {hello: {v: 1, session: i.session, publicKey: wallet, mac}, channel: await derive(i, keys.privateKey, i.publicKey, wallet, 'wallet')};
}
