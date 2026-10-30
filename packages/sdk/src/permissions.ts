import {canonical, digest, fixed, utf8, integer, nowSeconds, parseJSON, random, record, requireThat} from '@oathconnect/protocol';

export interface Capability {chain: string; account: string; methods: string[]}
export interface RequestedCapability {chain: string; methods: string[]; account?: string}
export interface SigningRequest {type: 'request'; id: string; chain: string; account: string; method: string; params: unknown; expires: number}
export interface Review {requestDigest: string; summary: string; warnings: string[]}
export interface Approval {approved: boolean; requestDigest: string}
export interface WalletAdapter {
  /** Must decode actual bytes, enforce network/account, and describe all signing effects. Fail closed for unknown transactions. */
  review(request: Readonly<SigningRequest>): Promise<Review>;
  /** Receives the same deeply frozen request that was reviewed. Never consult mutable website-supplied state. */
  execute(request: Readonly<SigningRequest>): Promise<unknown>;
}
export function validateCapabilities(value: unknown): Capability[] {
  requireThat(Array.isArray(value) && value.length > 0 && value.length <= 64, 'invalid_capabilities');
  const seen = new Set<string>();
  for (const c of value) {
    record(c, ['chain', 'account', 'methods']);
    requireThat(typeof c.chain === 'string' && /^[-a-z0-9]{3,8}:[-_a-zA-Z0-9]{1,32}$/.test(c.chain), 'invalid_chain');
    requireThat(typeof c.account === 'string' && /^[A-Za-z0-9:._-]{1,256}$/.test(c.account), 'invalid_account');
    requireThat(Array.isArray(c.methods) && c.methods.length > 0 && c.methods.length <= 32 && c.methods.every(m => typeof m === 'string' && /^[a-zA-Z][a-zA-Z0-9_]{0,63}$/.test(m)) && new Set(c.methods).size === c.methods.length, 'invalid_methods');
    const key = `${c.chain}/${c.account}`; requireThat(!seen.has(key), 'duplicate_capability'); seen.add(key);
  }
  return parseJSON(canonical(value)) as Capability[];
}
export function validateProposal(value: unknown): RequestedCapability[] {
  requireThat(Array.isArray(value) && value.length > 0 && value.length <= 64, 'invalid_proposal');
  const seen = new Set<string>();
  for (const c of value) {
    requireThat(c !== null && typeof c === 'object' && !Array.isArray(c), 'invalid_capability');
    record(c, Object.hasOwn(c, 'account') ? ['chain', 'account', 'methods'] : ['chain', 'methods']);
    validateCapabilities([{...c, account: c.account ?? 'wallet-selected'}]);
    const key = `${c.chain}/${c.account ?? '*'}`; requireThat(!seen.has(key), 'duplicate_capability'); seen.add(key);
  }
  return parseJSON(canonical(value)) as RequestedCapability[];
}
export function isSubset(approved: Capability[], requested: RequestedCapability[]): boolean {
  return approved.every(c => requested.some(r => r.chain === c.chain && (r.account === undefined || r.account === c.account) && c.methods.every(m => r.methods.includes(m))));
}
export function validateRequest(value: unknown, capabilities: readonly Capability[], now = nowSeconds()): SigningRequest {
  record(value, ['type', 'id', 'chain', 'account', 'method', 'params', 'expires']); requireThat(value.type === 'request');
  fixed(value.id, 16);
  integer(value.expires, now + 1, now + 120);
  requireThat(capabilities.some(c => c.chain === value.chain && c.account === value.account && c.methods.includes(value.method as string)), 'unauthorized_request');
  const encoded = canonical(value); requireThat(utf8(encoded).length <= 22_000, 'message_too_large');
  return deepFreeze(parseJSON(encoded)) as SigningRequest;
}
function deepFreeze(value: unknown): unknown {
  if (value && typeof value === 'object') { for (const child of Object.values(value)) deepFreeze(child); Object.freeze(value); }
  return value;
}
/** All requests, including message signing, require an explicit local decision. */
export class WalletAuthorizer {
  readonly #capabilities: Capability[]; readonly #seen = new Set<string>(); #closed = false; #busy = false;
  constructor(capabilities: Capability[], private readonly adapters: ReadonlyMap<string, WalletAdapter>, private readonly approve: (request: Readonly<SigningRequest>, review: Readonly<Review>) => Promise<Approval>) {
    this.#capabilities = deepFreeze(validateCapabilities(capabilities)) as Capability[];
  }
  close() { this.#closed = true; }
  async handle(value: unknown, now = nowSeconds()): Promise<unknown> {
    requireThat(!this.#closed && !this.#busy, 'wallet_unavailable');
    const request = validateRequest(value, this.#capabilities, now);
    requireThat(!this.#seen.has(request.id) && this.#seen.size < 1024, 'duplicate_or_exhausted_request');
    this.#seen.add(request.id); this.#busy = true;
    try {
      const adapter = this.adapters.get(`${request.chain}/${request.method}`); requireThat(adapter, 'unsupported_method');
      const requestDigest = await digest(canonical(request));
      const review = await adapter.review(request);
      record(review, ['requestDigest', 'summary', 'warnings']);
      requireThat(review.requestDigest === requestDigest && typeof review.summary === 'string' && review.summary.length > 0 && review.summary.length <= 4000 && Array.isArray(review.warnings) && review.warnings.length <= 20 && review.warnings.every(w => typeof w === 'string' && w.length <= 500), 'invalid_review');
      requireThat(!this.#closed && nowSeconds() < request.expires, 'request_expired');
      const approval = await this.approve(request, deepFreeze(parseJSON(canonical(review))) as Review);
      requireThat(!this.#closed && nowSeconds() < request.expires, 'request_expired');
      requireThat(approval.approved === true && approval.requestDigest === requestDigest, 'user_rejected');
      const result = await adapter.execute(request);
      requireThat(utf8(canonical(result)).length <= 22_000, 'result_too_large'); return result;
    } finally { this.#busy = false; }
  }
}
export function newRequest(capability: Capability, method: string, params: unknown, now = nowSeconds()): SigningRequest {
  return validateRequest({type: 'request', id: random(16), chain: capability.chain, account: capability.account, method, params, expires: now + 120}, [capability], now);
}
