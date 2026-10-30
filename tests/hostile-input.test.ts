import {test} from 'node:test';
import assert from 'node:assert/strict';
import {random, validateFrame, verifyGrant} from '@oathconnect/protocol';
import {validateCapabilities, validateProposal} from '@oathconnect/sdk';

test('bounded malformed-input corpus fails closed', async () => {
  const values = [null, false, 1, '', [], {}, {v: 1}, {v:2}, {__proto__:null}, {chain:'eip155:1',account:'x',methods:['eth_sign','eth_sign']}];
  for (const value of values) {
    assert.throws(() => validateFrame(value));
    assert.throws(() => validateCapabilities(value));
    assert.throws(() => validateProposal(value));
  }
  for (let n = 0; n < 100; n++) await assert.rejects(verifyGrant(`${random(32)}.${random(64)}`, [], 'https://relay.example', null));
});
