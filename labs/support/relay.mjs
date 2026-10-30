import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {canonical, importIssuer, issueGrant} from '@oathconnect/protocol';
import {RelayClient} from '@oathconnect/sdk';
import {fixture} from '../../tests/support/relay.ts';
export async function validationRelay() {
  if (process.env.OATHCONNECT_LIVE_VALIDATION !== 'true') {
    const f = await fixture(); return {...f,dispose:()=>f.mf.dispose(),description:'local Cloudflare workerd runtime; not a deployed relay test'};
  }
  const audience = 'https://oathconnect-preview.thuglifex.workers.dev';
  const projects = JSON.parse(readFileSync('registry/projects.json','utf8'));
  const project = projects.find(p=>p.id === 'oathconnect-validation');
  if (!project?.enabled || project.notAfter <= Math.floor(Date.now()/1000)) throw Error('validation_not_approved');
  const request = async path => {
    const r = await fetch(audience+path,{redirect:'error',signal:AbortSignal.timeout(15000),cache:'no-store'});
    if (!r.ok) throw Error('live_relay_unavailable'); return r.json();
  };
  const expectedCommit = execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
  if (!/^[a-f0-9]{40}$/.test(expectedCommit)) throw Error('invalid_local_commit');
  const health = await request('/health'), publicRegistry = await request('/v1/registry');
  if (health.commit !== expectedCommit || health.productionReady !== false || canonical(publicRegistry.projects ?? publicRegistry) !== canonical(projects)) throw Error('live_registry_mismatch');
  const issuer = await importIssuer(readFileSync('/tmp/oathconnect-validation-private/issuer.pkcs8','utf8'));
  const client = (session,role,identity) => new RelayClient({relay:audience,session,role,identity,origin:role==='dapp'?project.origins[0]:'',getGrant:()=>issueGrant({project:project.id,kid:'disposable',audience,session,role,origin:role==='dapp'?project.origins[0]:'',clientKey:identity.publicKey},issuer)});
  return {audience,projects,client,dispose:async()=>{},description:'deployed Cloudflare relay',deployedCommit:expectedCommit};
}
