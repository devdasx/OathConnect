import {canonical,createIdentity,createPairing,nowSeconds,ProtocolError,verifyGrant,type ClientIdentity,type Hello} from '@oathconnect/protocol';
import {RelayClient,Session} from '@oathconnect/sdk';
import registry from '../../registry/projects.json' with {type:'json'};
import {validateProjects} from '@oathconnect/protocol';

const projects=validateProjects(registry),relay=location.origin;
const status=document.querySelector<HTMLElement>('#status')!,checks=document.querySelector<HTMLUListElement>('#checks')!;
const prepare=document.querySelector<HTMLButtonElement>('#prepare')!,input=document.querySelector<HTMLInputElement>('#grant')!,start=document.querySelector<HTMLButtonElement>('#start')!,receiptButton=document.querySelector<HTMLButtonElement>('#receipt')!;
let identity:ClientIdentity,pairing:Awaited<ReturnType<typeof createPairing>>,grant='',session:Session|undefined,receipt:unknown;
const params={message:'OathConnect browser/native € 🔐',sequence:1};
function download(name:string,value:unknown){const url=URL.createObjectURL(new Blob([JSON.stringify(value,null,2)+'\n'],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
function fail(error:unknown){status.textContent='Check failed: '+(error instanceof ProtocolError?error.code:'interoperability_failure');prepare.disabled=false;start.disabled=true;input.disabled=true;void session?.close().catch(()=>{});}
function passed(label:string){const item=document.createElement('li');item.textContent='✓ '+label;checks.append(item);}
prepare.addEventListener('click',()=>void(async()=>{
  prepare.disabled=true;checks.replaceChildren();receiptButton.disabled=true;grant='';session=undefined;
  identity=await createIdentity();pairing=await createPairing(relay);
  download('oathconnect-bootstrap-'+Date.now()+'.json',{v:1,session:pairing.invitation.session,clientKey:identity.publicKey,uri:pairing.uri,relay,origin:location.origin});
  input.disabled=false;status.textContent='Pairing prepared. Run the local controller, then load its authorization file.';
})().catch(fail));
input.addEventListener('change',()=>void(async()=>{
  const file=input.files?.[0];if(!file||file.size>8192)throw Error('invalid_file');
  const value=JSON.parse(await file.text());
  if(value.session!==pairing.invitation.session||value.clientKey!==identity.publicKey||typeof value.grant!=='string')throw Error('wrong_authorization');
  const verified=await verifyGrant(value.grant,projects,relay,location.origin);
  if(verified.role!=='dapp'||verified.session!==value.session||verified.clientKey!==identity.publicKey)throw Error('wrong_authorization');
  grant=value.grant;input.value='';start.disabled=false;status.textContent='Authorization verified. Start the connection.';
})().catch(fail));
start.addEventListener('click',()=>void(async()=>{
  start.disabled=true;input.disabled=true;
  const client=new RelayClient({relay,session:pairing.invitation.session,role:'dapp',identity,getGrant:async()=>grant});
  await client.create(pairing.invitation.expires);status.textContent='Waiting for the standalone native client…';
  let hello:Hello|null=null;
  while(nowSeconds()<pairing.invitation.expires){hello=await client.hello();if(hello)break;await new Promise(r=>setTimeout(r,2000));}
  if(!hello)throw Error('pairing_timeout');
  session=new Session(await pairing.accept(hello),client,projects);passed('Browser WebCrypto ↔ native CryptoKit pairing');
  const approved=await session.propose([{chain:'oath:test',methods:['oath_echo']}]);
  if(approved.length!==1||approved[0]?.account!=='interop-fixture'||session.peer?.project!=='oathconnect-validation')throw Error('wrong_peer');
  passed('Signed native identity and wallet-selected capability');status.textContent='Waiting for the native approval and encrypted reply…';
  const result=await session.request(approved[0],'oath_echo',params);
  if(canonical(result)!==canonical({echo:params,native:true}))throw Error('wrong_result');
  passed('Digest-bound approval and Unicode request/reply');
  await session.close();passed('Session closed');
  receipt={v:1,completed:new Date().toISOString(),status:'passed',browser:navigator.userAgent,requestKind:'fixed echo; no blockchain signing',session:pairing.invitation.session,peer:session.peer,checks:4,result};
  grant='';status.textContent='PASS — Chrome/browser and standalone native client completed the encrypted round trip.';receiptButton.disabled=false;
})().catch(fail));
receiptButton.addEventListener('click',()=>download('oathconnect-browser-result-'+Date.now()+'.json',receipt));
