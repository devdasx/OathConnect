import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createIdentity, createProof, issueGrant, nowSeconds, random, verifyGrant, verifyProof, type Project} from '@oathconnect/protocol';

test('admission is bound to project, role, origin, audience, expiry and proof key', async () => {
  const issuer = await createIdentity(); const client = await createIdentity(); const attacker = await createIdentity();
  const projects: Project[] = [{id: 'example', name: 'Example', roles: ['dapp'], origins: ['https://app.example'], keys: {one: issuer.publicKey}, enabled: true}];
  const claims = {project: 'example', kid: 'one', audience: 'https://relay.example', session: random(), role: 'dapp' as const, origin: 'https://app.example', clientKey: client.publicKey};
  const token = await issueGrant(claims, issuer.privateKey);
  const grant = await verifyGrant(token, projects, claims.audience, claims.origin);
  await assert.rejects(verifyGrant(token, [], claims.audience, claims.origin), /project_not_approved/);
  await assert.rejects(verifyGrant(token, projects, 'https://evil.example', claims.origin), /wrong_audience/);
  await assert.rejects(verifyGrant(token, projects, claims.audience, null), /origin_mismatch/);
  await assert.rejects(verifyGrant(token, projects, claims.audience, claims.origin, nowSeconds() + 400));
  const proof = await createProof(token, client, 'POST', '/v1/sessions/abc/messages', '{"test":1}');
  await verifyProof(proof, grant, token, 'POST', '/v1/sessions/abc/messages', '{"test":1}');
  await assert.rejects(verifyProof(proof, grant, token, 'POST', '/v1/sessions/abc/messages', '{"test":2}'), /invalid_proof/);
  await assert.rejects(verifyProof(proof, grant, token, 'DELETE', '/v1/sessions/abc/messages', '{"test":1}'), /invalid_proof/);
  await assert.rejects(verifyProof(await createProof(token, attacker, 'GET', '/x'), grant, token, 'GET', '/x', ''), /invalid_proof/);
});
test('native empty-origin grants are wallet-only; disabled issuers revoke existing grants', async () => {
  const issuer = await createIdentity(); const client = await createIdentity();
  const project: Project = {id: 'wallet', name: 'Wallet', roles: ['wallet', 'dapp'], origins: [], keys: {one: issuer.publicKey}, enabled: true};
  const claims = {project: 'wallet', kid: 'one', audience: 'https://relay.example', session: random(), role: 'wallet' as const, origin: '', clientKey: client.publicKey};
  const token = await issueGrant(claims, issuer.privateKey);
  await verifyGrant(token, [project], claims.audience, null);
  await assert.rejects(verifyGrant(token, [{...project, notAfter: nowSeconds()}], claims.audience, null), /project_not_approved/);
  await assert.rejects(verifyGrant(token, [{...project, enabled: false}], claims.audience, null), /project_not_approved/);
  await assert.rejects(verifyGrant(token, [{...project, keys: {}}], claims.audience, null), /issuer_not_approved/);
  await assert.rejects(verifyGrant(await issueGrant({...claims, role: 'dapp'}, issuer.privateKey), [project], claims.audience, null), /origin_required/);
});
