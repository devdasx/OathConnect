import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,readdirSync,rmSync,writeFileSync,symlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {writeEvidence} from './evidence.mjs';

test('latest result does not discard previous run receipts',()=>{
  const root=mkdtempSync(join(tmpdir(),'oathconnect-evidence-'));
  try {
    writeEvidence('fixture',{run:1},root);writeEvidence('fixture',{run:2},root);
    assert.deepEqual(JSON.parse(readFileSync(join(root,'fixture.json'))),{run:2});
    const receipts=readdirSync(join(root,'fixture-runs')).map(p=>JSON.parse(readFileSync(join(root,'fixture-runs',p))).run);
    assert.deepEqual(receipts.sort(),[1,2]);
  } finally {rmSync(root,{recursive:true,force:true});}
});
test('a replaced latest-result symlink cannot redirect an evidence write',()=>{
  const root=mkdtempSync(join(tmpdir(),'oathconnect-evidence-'));
  try {
    const target=join(root,'unrelated.txt');writeFileSync(target,'preserve');symlinkSync(target,join(root,'fixture.json'));
    writeEvidence('fixture',{safe:true},root);
    assert.equal(readFileSync(target,'utf8'),'preserve');
    assert.deepEqual(JSON.parse(readFileSync(join(root,'fixture.json'))),{safe:true});
  } finally {rmSync(root,{recursive:true,force:true});}
});
