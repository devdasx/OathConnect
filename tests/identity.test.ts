import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createIdentity, random} from '@oathconnect/protocol';
import {isSubset, validateProposal} from '@oathconnect/sdk';
import {fixture} from './support/relay.ts';

test('verified identity binds issuer, session, origin, role and exact proposal', async () => {
  const f = await fixture();
  try {
    const session = random(); const d = f.client(session, 'dapp', await createIdentity()); const w = f.client(session, 'wallet', await createIdentity());
    const proposal = {type: 'proposal', capabilities: [{chain: 'eip155:11155111', methods: ['personal_sign']}]};
    const attestation = await d.attest(proposal);
    assert.equal((await w.identify(proposal, attestation, f.projects, 'dapp')).origin, 'https://app.example.org');
    await assert.rejects(w.identify({...proposal, capabilities: []}, attestation, f.projects, 'dapp'), /invalid_proof/);
    await assert.rejects(w.identify(proposal, attestation, [], 'dapp'), /project_not_approved/);
    await assert.rejects(w.identify(proposal, attestation, f.projects, 'wallet'), /identity_mismatch/);
    await assert.rejects(f.client(random(), 'wallet', await createIdentity()).identify(proposal, attestation, f.projects, 'dapp'), /identity_mismatch/);
  } finally {await f.mf.dispose();}
});
test('wallet-selected account discovery cannot broaden requested chains or methods', () => {
  const request = validateProposal([{chain: 'eip155:11155111', methods: ['personal_sign']}]);
  assert.equal(isSubset([{...request[0]!, account: 'selected'}], request), true);
  assert.equal(isSubset([{chain: 'eip155:1', account: 'selected', methods: ['personal_sign']}], request), false);
  assert.equal(isSubset([{chain: 'eip155:11155111', account: 'selected', methods: ['eth_sign']}], request), false);
  assert.equal(isSubset([{...request[0]!, account: 'different'}], [{...request[0]!, account: 'requested'}]), false);
});
