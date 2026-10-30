import type {DurableObjectNamespace, DurableObjectState, RateLimit} from '@cloudflare/workers-types';
import {fixed, integer, nowSeconds, opposite, parseJSON, ProtocolError, record, requireThat, validateFrame, verifyGrant, verifyProof, type Frame, type Grant, type Project} from '@oathconnect/protocol';
import projects from '../../registry/projects.json';

interface Env {SESSIONS: DurableObjectNamespace; PROJECTS: DurableObjectNamespace; PUBLIC_ORIGIN: string; RELEASE_SHA: string; MODE: string; IP_LIMIT: RateLimit; PROJECT_LIMIT: RateLimit}
type Peer = {key: string; project: string; kid: string};
interface State {session: string; pairExpires: number; expires: number; closed: boolean; dapp: Peer; wallet?: Peer; hello?: unknown; sent: {dapp: number; wallet: number}; ack: {dapp: number; wallet: number}; count: number; nonces: Record<string, number>; window: number; requests: number}
interface Internal {grant: Grant; nonce: string; proofAt: number; method: string; suffix: string; query: string; body: string}
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), {status, headers: {'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer'}});
const failure = (code: string, status = 400) => json({error: code}, status);
async function boundedBody(request: Request): Promise<string> {
  if (request.headers.has('content-encoding')) throw new ProtocolError('unsupported_encoding');
  if (!request.body) return '';
  const reader = request.body.getReader(); const chunks: Uint8Array[] = []; let total = 0;
  try {
    for (;;) { const part = await reader.read(); if (part.done) break; total += part.value.length; requireThat(total <= 36_000, 'message_too_large'); chunks.push(part.value); }
  } finally { await reader.cancel(); }
  const bytes = new Uint8Array(total); let offset = 0; for (const chunk of chunks) {bytes.set(chunk, offset); offset += chunk.length;}
  return new TextDecoder('utf-8', {fatal: true}).decode(bytes);
}
function cors(response: Response, origin: string | null): Response {
  if (origin && (projects as Project[]).some(p => p.enabled && p.origins.includes(origin))) {
    response.headers.set('Access-Control-Allow-Origin', origin); response.headers.set('Vary', 'Origin');
    response.headers.set('Access-Control-Allow-Headers', 'authorization, content-type, x-oath-proof');
    response.headers.set('Access-Control-Allow-Methods', 'GET, PUT, POST, DELETE, OPTIONS');
  }
  return response;
}
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const origin = request.headers.get('Origin');
    try {
      const url = new URL(request.url);
      requireThat(url.origin === env.PUBLIC_ORIGIN, 'wrong_audience');
      if (url.pathname === '/health' && request.method === 'GET') return json({service: 'OathConnect', protocol: 1, mode: env.MODE, productionReady: false, commit: env.RELEASE_SHA});
      if (url.pathname === '/v1/registry' && request.method === 'GET') return json({projects, commit: env.RELEASE_SHA});
      if (request.method === 'OPTIONS') return cors(new Response(null, {status: 204}), origin);
      const route = /^\/v1\/sessions\/([A-Za-z0-9_-]{43})(\/peer|\/messages)?$/.exec(url.pathname);
      requireThat(route, 'not_found'); fixed(route[1], 32);
      // Cloudflare sets CF-Connecting-IP. No supplied forwarding header is trusted.
      const ip = request.headers.get('CF-Connecting-IP') ?? 'unknown';
      if (!(await env.IP_LIMIT.limit({key: ip})).success) return cors(failure('rate_limited', 429), origin);
      const authorization = request.headers.get('Authorization') ?? '';
      requireThat(authorization.startsWith('Oath '), 'unauthorized');
      const token = authorization.slice(5);
      const grant = await verifyGrant(token, projects as Project[], env.PUBLIC_ORIGIN, origin);
      requireThat(grant.session === route[1], 'wrong_session');
      if (!(await env.PROJECT_LIMIT.limit({key: grant.project})).success) return cors(failure('rate_limited', 429), origin);
      const body = await boundedBody(request);
      const proof = await verifyProof(request.headers.get('X-Oath-Proof') ?? '', grant, token, request.method, url.pathname + url.search, body);
      const quota = env.PROJECTS.get(env.PROJECTS.idFromName(grant.project));
      const allocation = await quota.fetch('https://internal/', {method: 'POST', body: JSON.stringify({session: grant.session, create: request.method === 'PUT' && !route[2]})});
      if (!allocation.ok) return cors(failure('project_capacity', 429), origin);
      const object = env.SESSIONS.get(env.SESSIONS.idFromName(grant.session));
      const response = await object.fetch('https://internal/', {method: 'POST', body: JSON.stringify({grant, nonce: proof.nonce, proofAt: proof.at, method: request.method, suffix: route[2] ?? '', query: url.search, body} satisfies Internal)});
      return cors(new Response(await response.text(), {status: response.status, headers: [...response.headers]}), origin);
    } catch (error) {
      // Deliberately excludes request paths, bodies, tokens, accounts and arbitrary error strings.
      const code = error instanceof ProtocolError ? error.code : 'internal_error';
      return cors(failure(code, code === 'not_found' ? 404 : code === 'internal_error' ? 500 : 400), origin);
    }
  }
};

export class RelaySession {
  constructor(private readonly ctx: DurableObjectState) {}
  async fetch(request: Request): Promise<Response> {
    const input = await request.json() as Internal; const now = nowSeconds();
    try {
      const result = await this.ctx.storage.transaction(async txn => {
        let state = await txn.get<State>('state'); const g = input.grant;
        if (!state) {
          requireThat(input.method === 'PUT' && input.suffix === '' && g.role === 'dapp' && input.query === '', 'session_not_found');
          const body = parseJSON(input.body, 1024); record(body, ['pairExpires']); integer(body.pairExpires, now + 1, now + 300);
          state = {session: g.session, pairExpires: body.pairExpires, expires: body.pairExpires + 3300, closed: false, dapp: {key: g.clientKey, project: g.project, kid: g.kid}, sent: {dapp: 0, wallet: 0}, ack: {dapp: 0, wallet: 0}, count: 0, nonces: {}, window: now, requests: 0};
          await txn.setAlarm(state.expires * 1000);
        } else requireThat(!(input.method === 'PUT' && input.suffix === ''), 'session_exists');
        requireThat(!state.closed && state.expires > now && g.expires > now, 'session_closed');
        const peer = state[g.role];
        if (peer) requireThat(peer.key === g.clientKey && peer.project === g.project && peer.kid === g.kid, 'peer_mismatch');
        else requireThat(g.role === 'wallet' && input.method === 'PUT' && input.suffix === '/peer' && now < state.pairExpires, 'not_paired');
        state.nonces = Object.fromEntries(Object.entries(state.nonces).filter(([, expiry]) => expiry >= now));
        requireThat(!Object.hasOwn(state.nonces, input.nonce), 'replayed_proof');
        requireThat(Object.keys(state.nonces).length < 256, 'rate_limited');
        state.nonces[input.nonce] = input.proofAt + 31;
        if (now - state.window >= 60) {state.window = now; state.requests = 0;}
        requireThat(++state.requests <= 120 && ++state.count <= 12_000, 'rate_limited');
        const payload = input.body ? parseJSON(input.body, 36_000) : undefined;
        const other = opposite(g.role); let result: unknown = {ok: true};
        if (input.method === 'PUT' && input.suffix === '' && input.query === '') {
          result = {expires: state.expires};
        } else if (input.method === 'PUT' && input.suffix === '/peer' && input.query === '') {
          requireThat(g.role === 'wallet' && !state.wallet && now < state.pairExpires, 'already_paired');
          record(payload, ['v', 'session', 'publicKey', 'mac']); requireThat(payload.v === 1 && payload.session === state.session); fixed(payload.publicKey, 65); fixed(payload.mac, 32);
          state.wallet = {key: g.clientKey, project: g.project, kid: g.kid}; state.hello = payload;
        } else if (input.method === 'GET' && input.suffix === '/peer' && input.query === '' && !input.body) {
          requireThat(g.role === 'dapp'); result = {hello: state.hello ?? null};
        } else if (input.method === 'POST' && input.suffix === '/messages' && input.query === '') {
          requireThat(state.wallet, 'not_paired');
          const frame = validateFrame(payload, now);
          requireThat(frame.session === state.session && frame.sender === g.role && frame.expires === state.expires && frame.sequence === state.sent[g.role] + 1, 'invalid_frame');
          requireThat(state.sent[g.role] - state.ack[other] < 32, 'mailbox_full');
          await txn.put(`message:${g.role}:${String(frame.sequence).padStart(4, '0')}`, frame); state.sent[g.role] = frame.sequence;
        } else if (input.method === 'GET' && input.suffix === '/messages' && !input.body) {
          requireThat(/^\?after=(0|[1-9][0-9]{0,3})$/.test(input.query), 'invalid_cursor'); const after = Number(input.query.slice(7));
          requireThat(after >= state.ack[g.role] && after <= state.sent[other], 'invalid_cursor');
          const messages: Frame[] = [];
          for (let n = after + 1; n <= Math.min(after + 8, state.sent[other]); n++) { const frame = await txn.get<Frame>(`message:${other}:${String(n).padStart(4, '0')}`); requireThat(frame, 'invalid_cursor'); messages.push(frame); }
          result = {messages};
        } else if (input.method === 'DELETE' && input.suffix === '/messages' && !input.body) {
          requireThat(/^\?through=(0|[1-9][0-9]{0,3})$/.test(input.query), 'invalid_cursor'); const through = Number(input.query.slice(9));
          requireThat(through >= state.ack[g.role] && through <= state.sent[other], 'invalid_cursor');
          for (let n = state.ack[g.role] + 1; n <= through; n++) await txn.delete(`message:${other}:${String(n).padStart(4, '0')}`);
          state.ack[g.role] = through;
        } else if (input.method === 'DELETE' && input.suffix === '' && input.query === '' && !input.body) {
          state.closed = true; delete state.hello;
          const messages = await txn.list({prefix: 'message:'}); for (const key of messages.keys()) await txn.delete(key);
        } else throw new ProtocolError('unsupported_operation');
        await txn.put('state', state); return result;
      });
      return json(result);
    } catch (error) { return failure(error instanceof ProtocolError ? error.code : 'internal_error', 409); }
  }
  async alarm(): Promise<void> { await this.ctx.storage.deleteAll(); }
}

/** Global per-integrator budget. Edge rate limits alone are not a global allocation cap. */
export class ProjectQuota {
  constructor(private readonly ctx: DurableObjectState) {}
  async fetch(request: Request): Promise<Response> {
    const input = await request.json() as {session: string; create: boolean}; const now = nowSeconds();
    const allowed = await this.ctx.storage.transaction(async txn => {
      const state = await txn.get<{window: number; requests: number; sessions: Record<string, number>}>('quota') ?? {window: now, requests: 0, sessions: {}};
      if (now - state.window >= 60) {state.window = now; state.requests = 0;}
      state.sessions = Object.fromEntries(Object.entries(state.sessions).filter(([, expires]) => expires > now));
      if (state.requests >= 600) return false;
      state.requests++;
      if (input.create && !Object.hasOwn(state.sessions, input.session)) {
        if (Object.keys(state.sessions).length >= 100) return false;
        state.sessions[input.session] = now + 3600;
      }
      await txn.put('quota', state); await txn.setAlarm((now + 3601) * 1000); return true;
    });
    return json({ok: allowed}, allowed ? 200 : 429);
  }
  async alarm() {await this.ctx.storage.deleteAll();}
}
