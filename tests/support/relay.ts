import {build} from 'esbuild';
import {Miniflare, convertV4MiniflareOptions} from 'miniflare';
import {createIdentity, createProof, issueGrant, type ClientIdentity, type Project, type Role} from '@oathconnect/protocol';
import {RelayClient} from '@oathconnect/sdk';

export async function fixture() {
  const audience = 'https://relay.example.org'; const origin = 'https://app.example.org'; const issuer = await createIdentity();
  const projects: Project[] = [{id: 'test', name: 'Local test only', enabled: true, roles: ['wallet', 'dapp'], origins: [origin], keys: {one: issuer.publicKey}}];
  const bundle = await build({entryPoints: ['relay/src/worker.ts'], bundle: true, format: 'esm', platform: 'browser', target: 'es2023', write: false,
    plugins: [{name: 'test-registry', setup(b) {b.onLoad({filter: /registry\/projects\.json$/}, () => ({contents: JSON.stringify(projects), loader: 'json'}));}}]});
  const mf = new Miniflare(convertV4MiniflareOptions({name: 'relay', modules: true, script: bundle.outputFiles[0]!.text, compatibilityDate: '2026-07-01',
    durableObjects: {SESSIONS: {className: 'RelaySession', useSQLite: true}, PROJECTS: {className: 'ProjectQuota', useSQLite: true}}, bindings: {PUBLIC_ORIGIN: audience, RELEASE_SHA: 'test', MODE: 'test'},
    ratelimits: {IP_LIMIT: {namespace_id: '1', simple: {limit: 10000, period: 60}}, PROJECT_LIMIT: {namespace_id: '2', simple: {limit: 10000, period: 60}}}}));
  const fetcher: typeof fetch = async (input, init) => {
    const response = await mf.dispatchFetch(String(input), init as Parameters<typeof mf.dispatchFetch>[1]);
    return new Response(await response.arrayBuffer(), {status: response.status, headers: [...response.headers]});
  };
  const grant = (session: string, role: Role, identity: ClientIdentity) => issueGrant({project: 'test', kid: 'one', audience, session, role, origin: role === 'dapp' ? origin : '', clientKey: identity.publicKey}, issuer.privateKey);
  async function raw(session: string, role: Role, identity: ClientIdentity, method: string, suffix = '', data?: unknown, reuse?: {token: string; proof: string}) {
    const body = data === undefined ? '' : JSON.stringify(data); const target = `/v1/sessions/${session}${suffix}`;
    const token = reuse?.token ?? await grant(session, role, identity); const proof = reuse?.proof ?? await createProof(token, identity, method, target, body);
    const response = await fetcher(audience + target, {method, headers: {Authorization: `Oath ${token}`, 'X-Oath-Proof': proof, ...(role === 'dapp' ? {Origin: origin} : {})}, ...(body ? {body} : {})});
    return {response, body: await response.json() as Record<string, unknown>, token, proof};
  }
  const client = (session: string, role: Role, identity: ClientIdentity) => new RelayClient({relay: audience, session, role, identity, getGrant: () => grant(session, role, identity), fetch: fetcher, ...(role === 'dapp' ? {origin} : {})});
  return {mf, audience, raw, client, fetcher, projects};
}
