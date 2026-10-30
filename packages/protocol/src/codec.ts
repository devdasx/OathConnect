export class ProtocolError extends Error {
  constructor(public readonly code: string) { super(code); this.name = 'ProtocolError'; }
}
export function requireThat(value: unknown, code = 'invalid_message'): asserts value {
  if (!value) throw new ProtocolError(code);
}
export const utf8 = (s: string): Uint8Array<ArrayBuffer> => new TextEncoder().encode(s);
export function text(bytes: Uint8Array): string {
  try { return new TextDecoder('utf-8', {fatal: true}).decode(bytes); }
  catch { throw new ProtocolError('invalid_utf8'); }
}
export function b64(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}
export function unb64(value: unknown, max = 65536): Uint8Array<ArrayBuffer> {
  requireThat(typeof value === 'string' && value.length > 0 && value.length <= Math.ceil(max * 4 / 3) && /^[A-Za-z0-9_-]+$/.test(value), 'invalid_base64');
  let bytes: Uint8Array<ArrayBuffer>;
  try { bytes = Uint8Array.from(atob(value.replaceAll('-', '+').replaceAll('_', '/')), c => c.charCodeAt(0)); }
  catch { throw new ProtocolError('invalid_base64'); }
  requireThat(bytes.length <= max && b64(bytes) === value, 'invalid_base64');
  return bytes;
}
export function fixed(value: unknown, length: number): string {
  requireThat(unb64(value, length).length === length, 'invalid_length'); return value as string;
}
export const random = (n = 32) => b64(crypto.getRandomValues(new Uint8Array(n)));
export const nowSeconds = () => Math.floor(Date.now() / 1000);
export function record(value: unknown, keys: readonly string[]): asserts value is Record<string, unknown> {
  requireThat(value !== null && typeof value === 'object' && !Array.isArray(value));
  requireThat(Object.keys(value).length === keys.length && keys.every(k => Object.hasOwn(value, k)), 'unexpected_fields');
}
export function integer(value: unknown, min: number, max: number): asserts value is number {
  requireThat(Number.isSafeInteger(value) && (value as number) >= min && (value as number) <= max, 'invalid_integer');
}
export function parseJSON(raw: string, max = 65536): unknown {
  requireThat(utf8(raw).length <= max, 'message_too_large');
  try { return JSON.parse(raw); } catch { throw new ProtocolError('invalid_json'); }
}
export function relayOrigin(value: unknown): string {
  requireThat(typeof value === 'string' && value.length <= 256, 'invalid_origin');
  let url: URL;
  try { url = new URL(value); } catch { throw new ProtocolError('invalid_origin'); }
  requireThat(url.protocol === 'https:' && url.origin === value && !url.username && !url.password, 'invalid_origin');
  return value;
}
export const digest = async (value: string) => b64(new Uint8Array(await crypto.subtle.digest('SHA-256', utf8(value))));
export type Role = 'dapp' | 'wallet';
export function role(value: unknown): asserts value is Role { requireThat(value === 'dapp' || value === 'wallet', 'invalid_role'); }
export const opposite = (value: Role): Role => value === 'dapp' ? 'wallet' : 'dapp';

/** A bounded, deterministic serialization for request digests, not general-purpose JSON. */
export function canonical(value: unknown, depth = 0): string {
  requireThat(depth <= 24, 'too_deep');
  if (typeof value === 'string') { requireThat(!/[\uD800-\uDFFF]/u.test(value), 'invalid_unicode'); return JSON.stringify(value); }
  if (value === null || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number') { requireThat(Number.isSafeInteger(value), 'unsafe_number'); return JSON.stringify(value); }
  if (Array.isArray(value)) { requireThat(value.length <= 1024); return `[${value.map(v => canonical(v, depth + 1)).join(',')}]`; }
  requireThat(value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype);
  const entries = Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
  requireThat(entries.length <= 128);
  requireThat(entries.every(([key]) => /^[\x20-\x7E]{1,128}$/.test(key)), 'invalid_object_key');
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v, depth + 1)}`).join(',')}}`;
}
