import {readdirSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
const root=process.argv[2];
if(!root)throw Error('SARIF output directory required');
const files=readdirSync(root).filter(n=>n.endsWith('.sarif'));
if(!files.length)throw Error('No security analysis result was produced');
let findings=0;
for(const file of files){const sarif=JSON.parse(readFileSync(join(root,file),'utf8'));if(!Array.isArray(sarif.runs)||!sarif.runs.length)throw Error('Invalid security analysis output');for(const run of sarif.runs){if(!Array.isArray(run.results))throw Error('Missing security findings list');findings+=run.results.length;}}
if(findings)throw Error(`Security analysis reported ${findings} findings; review and fix before deployment`);
console.log('Security analysis reported no findings in its configured scope.');
