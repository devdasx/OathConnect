// Operator-only file exchange. Issuer key stays in this Node process, never in either client.
import {mkdtempSync,chmodSync,readFileSync,lstatSync,writeFileSync} from 'node:fs';
import {execFileSync,spawn} from 'node:child_process';
import {join,resolve} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {canonical,fixed,importIssuer,issueGrant,parseInvitation,record,validateProjects,nowSeconds} from '@oathconnect/protocol';
import {readJSON,writePrivate} from './files.mjs';
import {writeEvidence} from '../support/evidence.mjs';

const relay='https://oathconnect-preview.thuglifex.workers.dev';
const sourceCommit=()=>execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
async function verifiedRegistry(){
  const projects=validateProjects(readJSON('registry/projects.json'));
  const project=projects.find(p=>p.id==='oathconnect-validation');
  if(!project?.enabled||!project.notAfter||project.notAfter<=nowSeconds()+300||!project.origins.includes(relay))throw Error('validation_not_approved');
  const get=async path=>{const r=await fetch(relay+path,{redirect:'error',cache:'no-store',signal:AbortSignal.timeout(15000)});if(!r.ok)throw Error('relay_unavailable');return r.json();};
  const [health,registry]=await Promise.all([get('/health'),get('/v1/registry')]);
  if(health.commit!==sourceCommit()||health.productionReady!==false||canonical(registry.projects)!==canonical(projects))throw Error('deployed_source_mismatch');
  return projects;
}
async function grant(session,clientKey,role){
  fixed(clientKey,32);fixed(session,32);
  const issuer=await importIssuer(readFileSync('/tmp/oathconnect-validation-private/issuer.pkcs8','utf8'));
  return issueGrant({project:'oathconnect-validation',kid:'disposable',audience:relay,session,clientKey,role,origin:role==='dapp'?relay:''},issuer);
}
function privateDirectory(value){
  const directory=resolve(value);
  if(!/^\/tmp\/oathconnect-browser-native-[A-Za-z0-9]+$/.test(directory))throw Error('invalid_directory');
  const s=lstatSync(directory);if(!s.isDirectory()||s.isSymbolicLink()||(s.mode&0o077)!==0||s.uid!==process.getuid())throw Error('unsafe_directory');
  return directory;
}
async function prepare(path){
  const bootstrap=readJSON(path,8192);record(bootstrap,['v','session','clientKey','uri','relay','origin']);
  if(bootstrap.v!==1||bootstrap.relay!==relay||bootstrap.origin!==relay)throw Error('invalid_bootstrap');
  const invitation=parseInvitation(bootstrap.uri,relay);fixed(bootstrap.clientKey,32);
  if(invitation.session!==bootstrap.session||invitation.expires<nowSeconds()+120)throw Error('expired_bootstrap');
  const projects=await verifiedRegistry();
  const directory=mkdtempSync('/tmp/oathconnect-browser-native-');chmodSync(directory,0o700);
  writePrivate(join(directory,'config.json'),{uri:bootstrap.uri,relay,session:bootstrap.session,projects,directory});
  writePrivate(join(directory,'context.json'),{session:bootstrap.session,deployedCommit:sourceCommit(),expires:invitation.expires});
  writePrivate(join(directory,'browser-grant.json'),{session:bootstrap.session,clientKey:bootstrap.clientKey,grant:await grant(bootstrap.session,bootstrap.clientKey,'dapp')});
  // Only paths are printed. The pairing secret, grants and proof keys stay off stdout.
  console.log('Private test directory: '+directory);
  console.log('Load browser-grant.json, click Start connection, then run this controller with: run <directory> <InteropHost executable>');
}
async function run(value,executable){
  const directory=privateDirectory(value),context=readJSON(join(directory,'context.json'));
  if(context.expires<=nowSeconds()+30||context.deployedCommit!==sourceCommit())throw Error('stale_test');
  await verifiedRegistry();
  const child=spawn(resolve(executable),[join(directory,'config.json')],{stdio:['ignore','inherit','inherit']});
  let ended=false;const completion=new Promise((accept,reject)=>{child.once('error',reject);child.once('exit',code=>{ended=true;code===0?accept():reject(Error('native_fixture_failed'));});});
  // Observe errors immediately while waiting for the public proof key.
  void completion.catch(()=>{});
  const timeout=setTimeout(()=>child.kill('SIGTERM'),240000);
  try {
    const until=Date.now()+30000;let key;
    while(Date.now()<until&&!ended){try{key=readJSON(join(directory,'wallet-key.json'),4096);break;}catch(e){if(e.code!=='ENOENT')throw e;}await delay(100);}
    record(key,['session','clientKey']);if(key.session!==context.session)throw Error('wrong_wallet');fixed(key.clientKey,32);
    writePrivate(join(directory,'wallet-grant.json'),{session:context.session,clientKey:key.clientKey,grant:await grant(context.session,key.clientKey,'wallet')});
    await completion;
  } finally {clearTimeout(timeout);if(!ended)child.kill('SIGTERM');}
}
async function finish(value,path){
  const directory=privateDirectory(value),context=readJSON(join(directory,'context.json'));
  const native=readJSON(join(directory,'native-result.json')),browser=readJSON(path);
  const expected={echo:{message:'OathConnect browser/native € 🔐',sequence:1},native:true};
  if(context.deployedCommit!==sourceCommit()||native.session!==context.session||browser.session!==context.session||native.status!=='passed'||browser.status!=='passed'||native.approvals!==1||native.executions!==1||browser.checks!==4||browser.peer?.project!=='oathconnect-validation'||canonical(browser.result)!==canonical(expected))throw Error('result_mismatch');
  if(typeof browser.browser!=='string'||browser.browser.length>512||typeof native.platform!=='string'||native.platform.length>256)throw Error('invalid_platform');
  writeEvidence('browser-native-live',{v:1,completed:new Date().toISOString(),status:'passed',deployedCommit:context.deployedCommit,relay,browser:browser.browser,native:native.platform,requestKind:'fixed echo; no blockchain signing',checks:['P-256 ECDH + QR-secret authentication across WebCrypto/CryptoKit','Both peer identities verified against separately bundled public registry','Wallet-selected exact capability; one digest-bound approval and one execution','Unicode encrypted request/reply and explicit browser close'],approvals:1,executions:1,limitations:['Standalone macOS host, not Oath Wallet or iOS runtime','No blockchain signing, mainnet transaction, independent audit or production certification']});
  writeFileSync(join(directory,'finish'),'finished\n',{mode:0o600,flag:'wx'});
  console.log('Verified browser/native evidence saved without pairing secrets or credentials.');
}
try {
  const [mode,...args]=process.argv.slice(2);
  if(mode==='prepare'&&args.length===1)await prepare(args[0]);
  else if(mode==='run'&&args.length===2)await run(args[0],args[1]);
  else if(mode==='finish'&&args.length===2)await finish(args[0],args[1]);
  else throw Error('invalid_arguments');
} catch {console.error('Browser/native controller failed; sensitive input omitted. Check approval expiry, deployed commit and fixture stage.');process.exitCode=1;}
