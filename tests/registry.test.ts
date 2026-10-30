import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createIdentity, validateProjects} from '@oathconnect/protocol';
test('registry rejects ambiguous identities, unsafe origins, unknown fields and invalid expiry', async () => {
  const key = await createIdentity();
  const project = {id:'test',name:'Test',enabled:true,roles:['wallet'],origins:[],keys:{one:key.publicKey}};
  assert.deepEqual(validateProjects([project]),[project]);
  for (const value of [[project,project],[{...project,origins:['http://insecure.example']}],[{...project,notAfter:0}],[{...project,roles:['wallet','wallet']}],[{...project,keys:{one:'invalid'}}],[{...project,unknown:1}]]) assert.throws(()=>validateProjects(value));
});
