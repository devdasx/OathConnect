import {canonical, createProof, parseJSON, ProtocolError, record, relayOrigin, requireThat, verifyGrant, verifyProof, type ClientIdentity, type Frame, type Hello, type Project, type Role} from '@oathconnect/protocol';

export interface RelayOptions {relay: string; session: string; role: Role; identity: ClientIdentity; getGrant: () => Promise<string>; fetch?: typeof globalThis.fetch; origin?: string}
export interface PeerIdentity {project: string; name: string; origin: string; role: Role}
export interface Attestation {origin: string; grant: string; proof: string}
export class RelayClient {
  readonly #options: RelayOptions; #closed = false;
  constructor(options: RelayOptions) { relayOrigin(options.relay); this.#options = {...options}; }
  async attest(value: unknown): Promise<Attestation> {
    const o = this.#options, grant = await o.getGrant();
    return {origin: o.origin ?? '', grant, proof: await createProof(grant, o.identity, 'ATTEST', `/v1/sessions/${o.session}`, canonical(value))};
  }
  async identify(value: unknown, attestation: unknown, projects: readonly Project[], expectedRole: Role): Promise<PeerIdentity> {
    record(attestation, ['origin', 'grant', 'proof']);
    requireThat(typeof attestation.origin === 'string' && typeof attestation.grant === 'string' && typeof attestation.proof === 'string', 'invalid_attestation');
    const o = this.#options;
    const grant = await verifyGrant(attestation.grant, projects, o.relay, attestation.origin || null);
    requireThat(grant.role === expectedRole && grant.session === o.session, 'identity_mismatch');
    await verifyProof(attestation.proof, grant, attestation.grant, 'ATTEST', `/v1/sessions/${o.session}`, canonical(value));
    return {project: grant.project, name: projects.find(p => p.id === grant.project)!.name, origin: grant.origin, role: grant.role};
  }
  async call(method: string, suffix = '', payload?: unknown): Promise<unknown> {
    requireThat(!this.#closed, 'session_closed');
    const o = this.#options; const path = `/v1/sessions/${o.session}${suffix}`;
    const body = payload === undefined ? '' : canonical(payload); const token = await o.getGrant();
    const headers: Record<string, string> = {Authorization: `Oath ${token}`, 'X-Oath-Proof': await createProof(token, o.identity, method, path, body)};
    if (body) headers['Content-Type'] = 'application/json';
    // Native/Node harness only. Browsers set Origin themselves.
    if (o.origin) headers.Origin = o.origin;
    let response: Response;
    try { response = await (o.fetch ?? globalThis.fetch)(o.relay + path, {method, headers, ...(body ? {body} : {}), redirect: 'error', credentials: 'omit', cache: 'no-store', signal: AbortSignal.timeout(15_000)}); }
    catch { this.#closed = true; throw new ProtocolError('delivery_unknown_repair_required'); }
    const reader = response.body?.getReader(); const chunks: Uint8Array[] = []; let size = 0;
    if (reader) {
      try { for (;;) { const r = await reader.read(); if (r.done) break; size += r.value.length; requireThat(size <= 290_000, 'response_too_large'); chunks.push(r.value); } }
      catch (error) { this.#closed = true; throw error; }
      finally { await reader.cancel(); }
    }
    const all = new Uint8Array(size); let offset = 0; for (const c of chunks) {all.set(c, offset); offset += c.length;}
    const data = parseJSON(new TextDecoder('utf-8', {fatal: true}).decode(all), 290_000);
    if (!response.ok) { this.#closed = true; throw new ProtocolError(`relay_rejected_${response.status}`); }
    return data;
  }
  create(pairExpires: number) { return this.call('PUT', '', {pairExpires}); }
  join(hello: Hello) { return this.call('PUT', '/peer', hello); }
  async hello(): Promise<Hello | null> { const r = await this.call('GET', '/peer'); record(r, ['hello']); return r.hello as Hello | null; }
  send(frame: Frame) { return this.call('POST', '/messages', frame); }
  async receive(after: number): Promise<Frame[]> { const r = await this.call('GET', `/messages?after=${after}`); record(r, ['messages']); requireThat(Array.isArray(r.messages) && r.messages.length <= 8, 'invalid_response'); return r.messages as Frame[]; }
  acknowledge(through: number) { return this.call('DELETE', `/messages?through=${through}`); }
  async close() { try { if (!this.#closed) await this.call('DELETE'); } finally { this.#closed = true; } }
}
