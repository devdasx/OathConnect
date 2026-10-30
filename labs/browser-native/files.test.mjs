import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,writeFileSync,symlinkSync,readFileSync,statSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {readJSON,writePrivate} from './files.mjs';
test('private fixture exchange bounds input and refuses symlink reads',()=>{
  const dir=mkdtempSync(join(tmpdir(),'oathconnect-files-'));
  try {
    const path=join(dir,'input.json');writePrivate(path,{ok:true});assert.deepEqual(readJSON(path),{ok:true});
    assert.equal(statSync(path).mode&0o777,0o600);
    assert.throws(()=>readJSON(path,2),/invalid_file/);
    const link=join(dir,'link.json');symlinkSync(path,link);assert.throws(()=>readJSON(link));
    writePrivate(link,{replaced:true});assert.deepEqual(readJSON(path),{ok:true});assert.deepEqual(readJSON(link),{replaced:true});
    writeFileSync(path,Buffer.from([0x22,0xff,0x22]));assert.throws(()=>readJSON(path));
    assert.equal(readFileSync(path).length,3);
  } finally {rmSync(dir,{recursive:true,force:true});}
});
