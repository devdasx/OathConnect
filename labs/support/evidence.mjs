import {mkdirSync, writeFileSync, renameSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {join} from 'node:path';

/** Preserve every run, then atomically replace the latest public evidence snapshot. */
export function writeEvidence(name, value, directory = 'evidence') {
  if (!/^[a-z0-9-]{1,80}$/.test(name)) throw Error('invalid_evidence_name');
  const payload = JSON.stringify(value,null,2)+'\n';
  if (Buffer.byteLength(payload) > 65536) throw Error('evidence_too_large');
  const run = randomUUID(), archive = join(directory,name+'-runs');
  mkdirSync(archive,{recursive:true});
  writeFileSync(join(archive,run+'.json'),payload,{flag:'wx'});
  const temporary = join(directory,'.'+name+'-'+run+'.tmp');
  writeFileSync(temporary,payload,{flag:'wx'});
  // Replacing a destination symlink does not follow it. Concurrent runs each retain
  // their unique archive even when another run becomes the latest snapshot.
  renameSync(temporary,join(directory,name+'.json'));
}
