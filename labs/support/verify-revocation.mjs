// Confirm an already-issued grant stops working after its project is disabled via GitHub.
import {execFileSync} from 'node:child_process';
import {readFileSync,writeFileSync} from 'node:fs';
import {createIdentity,createPairing,createProof,importIssuer,issueGrant} from '@oathconnect/protocol';
const relay='https://oathconnect-preview.thuglifex.workers.dev',origin='https://validation.oathconnect.invalid';
const issuer=await importIssuer(readFileSync('/tmp/oathconnect-validation-private/issuer.pkcs8','utf8'));
const identity=await createIdentity(),pairing=await createPairing(relay),session=pairing.invitation.session,path='/v1/sessions/'+session;
const token=await issueGrant({project:'oathconnect-validation',kid:'disposable',audience:relay,session,role:'dapp',origin,clientKey:identity.publicKey},issuer);
async function call(method,suffix='',body=''){
 const r=await fetch(relay+path+suffix,{method,headers:{Origin:origin,Authorization:'Oath '+token,'X-Oath-Proof':await createProof(token,identity,method,path+suffix,body)},...(body?{body}:{}),signal:AbortSignal.timeout(10000),redirect:'error'});
 return {status:r.status,value:await r.json()};
}
const before=await call('PUT','',JSON.stringify({pairExpires:pairing.invitation.expires}));
if(before.status!==200)throw Error('initial_admission_failed');
console.log('Existing test grant accepted; waiting for GitHub-deployed revocation.');
const started=Date.now();let result;
while(Date.now()-started<240000){
 const r=await fetch(relay+'/v1/registry',{cache:'no-store',signal:AbortSignal.timeout(10000),redirect:'error'});const registry=await r.json();
 if(!registry.projects.some(p=>p.id==='oathconnect-validation'&&p.enabled)){
  result=await call('GET','/peer');
  if(result.status!==400||result.value.error!=='project_not_approved')throw Error('revocation_not_enforced');
  const expectedCommit=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
  if(!/^[a-f0-9]{40}$/.test(expectedCommit)||registry.commit!==expectedCommit)throw Error('unexpected_deployed_commit');
  const evidence={checkedAt:new Date().toISOString(),transport:'deployed Cloudflare relay',deployedCommit:expectedCommit,beforeStatus:before.status,afterStatus:400,afterCode:'project_not_approved',grantStillWithinOriginalLifetime:true,status:'passed'};
  writeFileSync('evidence/live-revocation.json',JSON.stringify(evidence,null,2)+'\n');console.log(JSON.stringify(evidence));break;
 }
 await new Promise(resolve=>setTimeout(resolve,3000));
}
if(!result)throw Error('revocation_deployment_timeout');
