import {random,parseJSON,record,ProtocolError} from '@oathconnect/protocol';
import {check} from './transfer.mjs';
import {labNetwork} from './networks.mjs';
const methods=new Set(['getGenesisHash','getBalance','getMultipleAccounts','getMinimumBalanceForRentExemption','getLatestBlockhash','isBlockhashValid','getFeeForMessage','simulateTransaction','sendTransaction','getSignatureStatuses','getTransaction']);
// JSON.parse establishes syntax; this bounded token pass rejects duplicate decoded
// keys (including escaped aliases) before any parsed provider value is used.
function parseLabJSON(raw){
 const parsed=parseJSON(raw,65536),stack=[];
 for(let i=0;i<raw.length;i++){
  const c=raw[i];
  if(c==='"'){
   const start=i;for(i++;i<raw.length;i++){if(raw[i]==='\\'){i++;continue;}if(raw[i]==='"')break;}
   const frame=stack.at(-1);
   if(frame?.keys&&frame.key){const key=JSON.parse(raw.slice(start,i+1));check(!frame.keys.has(key),'solana_rpc_duplicate_key');frame.keys.add(key);frame.key=false;}
  }else if(c==='{'||c==='['){stack.push(c==='{'?{keys:new Set(),key:true}:{});check(stack.length<=24,'solana_rpc_response_too_deep');}
  else if(c==='}'||c===']')stack.pop();
  else if(c===','&&stack.at(-1)?.keys)stack.at(-1).key=true;
 }
 return parsed;
}
export class SolanaLabRpcError extends ProtocolError{
 constructor(code,method,details={}){super(code);this.method=method;if(details.status!==undefined)this.status=details.status;if(details.providerCode!==undefined)this.providerCode=details.providerCode;}
}
export class SolanaLabRpc {
 #network;
 constructor(fetcher=globalThis.fetch,networkName='devnet'){this.#network=labNetwork(networkName);this.fetcher=fetcher;}
 async request(method,params=[],signal=AbortSignal.timeout(15000)){
  check(methods.has(method)&&Array.isArray(params)&&params.length<=3,'solana_rpc_unsupported_method');
  check(!signal.aborted,'solana_rpc_cancelled');
  const id=random(12),body=JSON.stringify({jsonrpc:'2.0',id,method,params});check(Buffer.byteLength(body)<=10000,'solana_rpc_request_too_large');
  try{
   const r=await this.fetcher(this.#network.endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body,redirect:'error',credentials:'omit',cache:'no-store',signal:AbortSignal.any([signal,AbortSignal.timeout(15000)])});
   if(!r.ok){await r.body?.cancel().catch(()=>{});throw new SolanaLabRpcError('solana_rpc_http_failure',method,{status:r.status});}
   const reader=r.body?.getReader();check(reader,'solana_rpc_empty_response');let size=0;const chunks=[];
   try{for(;;){const part=await reader.read();if(part.done)break;size+=part.value.length;check(size<=65536,'solana_rpc_response_too_large');chunks.push(part.value);}}finally{await reader.cancel().catch(()=>{});}
   const v=parseLabJSON(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks)));
   check(v&&typeof v==='object'&&!Array.isArray(v)&&v.jsonrpc==='2.0'&&v.id===id,'solana_rpc_response_mismatch');
   if(Object.hasOwn(v,'error')){const code=v.error?.code;throw new SolanaLabRpcError('solana_rpc_rejected',method,{providerCode:Number.isSafeInteger(code)?code:null});}
   record(v,['jsonrpc','id','result']);return v.result;
  }catch(error){if(error instanceof ProtocolError)throw error;throw new ProtocolError('solana_rpc_delivery_unknown');}
 }
}
