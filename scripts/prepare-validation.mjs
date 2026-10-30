// Operator-only disposable qualification identity. Never run from a browser or public endpoint.
import {generateKeyPairSync} from 'node:crypto';
import {mkdirSync, writeFileSync} from 'node:fs';
import {b64} from '@oathconnect/protocol';
const directory = '/tmp/oathconnect-validation-private';
mkdirSync(directory,{mode:0o700});
const pair = generateKeyPairSync('ed25519');
const encoded = b64(pair.privateKey.export({format:'der',type:'pkcs8'}));
writeFileSync(directory+'/issuer.pkcs8',encoded,{mode:0o600,flag:'wx'});
const project = {id:'oathconnect-validation',name:'OathConnect disposable testnet validation',roles:['wallet','dapp'],origins:['https://validation.oathconnect.invalid','https://oathconnect-preview.thuglifex.workers.dev'],keys:{disposable:b64(pair.publicKey.export({format:'der',type:'spki'}).subarray(-32))},enabled:true,notAfter:Math.floor(Date.now()/1000)+3600};
writeFileSync('registry/projects.json',JSON.stringify([project],null,2)+'\n');
console.log('Prepared a one-hour public validation approval. Private issuer material stays outside the repository.');
