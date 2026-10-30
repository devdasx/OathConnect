import {b64, canonical, digest, fixed, integer, nowSeconds, parseJSON, random, record, relayOrigin, requireThat, role, text, unb64, utf8, type Role} from './codec.js';

export interface Project {id: string; name: string; roles: Role[]; origins: string[]; keys: Record<string, string>; enabled: boolean}
export interface Grant {v: 1; project: string; kid: string; audience: string; session: string; role: Role; origin: string; clientKey: string; issued: number; expires: number; id: string}
export interface Proof {v: 1; at: number; nonce: string; signature: string}
export interface ClientIdentity {privateKey: CryptoKey; publicKey: string}
export async function createIdentity(): Promise<ClientIdentity> {
  const pair = await crypto.subtle.generateKey('Ed25519', false, ['sign', 'verify']);
  return {privateKey: pair.privateKey, publicKey: b64(new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey)))};
}
export async function importIssuer(pkcs8: string): Promise<CryptoKey> {
  return crypto.subtle.importKey('pkcs8', unb64(pkcs8, 128), 'Ed25519', false, ['sign']);
}
function validateGrant(value: unknown, now: number): Grant {
  record(value, ['v', 'project', 'kid', 'audience', 'session', 'role', 'origin', 'clientKey', 'issued', 'expires', 'id']);
  requireThat(value.v === 1, 'unsupported_version');
  for (const key of ['project', 'kid'] as const) requireThat(typeof value[key] === 'string' && /^[a-z0-9][a-z0-9_-]{0,63}$/.test(value[key]), 'invalid_identifier');
  relayOrigin(value.audience); role(value.role); fixed(value.session, 32); fixed(value.clientKey, 32); fixed(value.id, 16);
  requireThat(value.origin === '' || relayOrigin(value.origin), 'invalid_origin');
  integer(value.issued, now - 300, now + 5); integer(value.expires, now + 1, now + 305);
  requireThat(value.expires > value.issued && value.expires - value.issued <= 300, 'grant_lifetime');
  return value as unknown as Grant;
}
/** Backend only. Issuer keys MUST NOT be embedded in apps or shipped to browsers. */
export async function issueGrant(claims: Omit<Grant, 'v' | 'issued' | 'expires' | 'id'>, issuer: CryptoKey, now = nowSeconds()): Promise<string> {
  const grant = validateGrant({...claims, v: 1, issued: now, expires: now + 300, id: random(16)}, now);
  const payload = b64(utf8(canonical(grant)));
  const signature = b64(new Uint8Array(await crypto.subtle.sign('Ed25519', issuer, utf8(`OathConnect/grant/v1.${payload}`))));
  return `${payload}.${signature}`;
}
export async function verifyGrant(token: string, projects: readonly Project[], audience: string, origin: string | null, now = nowSeconds()): Promise<Grant> {
  requireThat(token.length <= 4096 && token.split('.').length === 2, 'invalid_grant');
  const [payload, signature] = token.split('.') as [string, string];
  const grant = validateGrant(parseJSON(text(unb64(payload, 2048)), 2048), now);
  requireThat(grant.audience === audience, 'wrong_audience');
  const project = projects.find(p => p.id === grant.project && p.enabled);
  requireThat(project && project.roles.includes(grant.role), 'project_not_approved');
  const issuer = Object.hasOwn(project.keys, grant.kid) ? project.keys[grant.kid] : undefined;
  requireThat(issuer, 'issuer_not_approved');
  if (grant.origin === '') requireThat(grant.role === 'wallet' && origin === null, 'origin_required');
  else requireThat(origin === grant.origin && project.origins.includes(grant.origin), 'origin_mismatch');
  fixed(issuer, 32); fixed(signature, 64);
  const key = await crypto.subtle.importKey('raw', unb64(issuer, 32), 'Ed25519', false, ['verify']);
  requireThat(await crypto.subtle.verify('Ed25519', key, unb64(signature, 64), utf8(`OathConnect/grant/v1.${payload}`)), 'invalid_grant_signature');
  return grant;
}
async function proofData(token: string, method: string, target: string, body: string, at: number, nonce: string) {
  return utf8(JSON.stringify(['OathConnect/proof/v1', await digest(token), method, target, await digest(body), at, nonce]));
}
export async function createProof(token: string, identity: ClientIdentity, method: string, target: string, body = '', at = nowSeconds()): Promise<string> {
  const nonce = random(16);
  const signature = b64(new Uint8Array(await crypto.subtle.sign('Ed25519', identity.privateKey, await proofData(token, method, target, body, at, nonce))));
  return b64(utf8(JSON.stringify({v: 1, at, nonce, signature})));
}
export async function verifyProof(encoded: string, grant: Grant, token: string, method: string, target: string, body: string, now = nowSeconds()): Promise<Proof> {
  const value = parseJSON(text(unb64(encoded, 512)), 512);
  record(value, ['v', 'at', 'nonce', 'signature']); requireThat(value.v === 1);
  integer(value.at, now - 30, now + 5); fixed(value.nonce, 16); fixed(value.signature, 64);
  const key = await crypto.subtle.importKey('raw', unb64(grant.clientKey, 32), 'Ed25519', false, ['verify']);
  requireThat(await crypto.subtle.verify('Ed25519', key, unb64(value.signature, 64), await proofData(token, method, target, body, value.at, value.nonce as string)), 'invalid_proof');
  return value as unknown as Proof;
}
