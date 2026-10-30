import {Interface, Transaction, toQuantity} from 'ethers';
import {nowSeconds, parseJSON, ProtocolError, random, record, requireThat} from '@oathconnect/protocol';
import type {EvmPlan, EvmState} from './index.js';

const tokenRead = new Interface(['function balanceOf(address) view returns (uint256)', 'function allowance(address,address) view returns (uint256)']);
const methods = new Set(['eth_chainId','eth_getBlockByNumber','eth_getBalance','eth_getTransactionCount','eth_getCode','eth_call','eth_sendRawTransaction','eth_getTransactionReceipt','eth_gasPrice','eth_maxPriorityFeePerGas']);
/** Safe provider context only: no response text, params, URLs or signed payloads. */
export class EvmRpcError extends ProtocolError {
  constructor(readonly method: string, readonly providerCode: number | null) {super('evm_rpc_rejected');}
}
/** HTTP status only; the provider's response body and headers are never exposed. */
export class EvmRpcHttpError extends ProtocolError {
  constructor(readonly method: string, readonly status: number) {super('evm_rpc_http_failure');}
}
function quantity(value: unknown): string {
  requireThat(typeof value === 'string' && /^0x(0|[1-9a-f][0-9a-f]{0,63})$/.test(value), 'evm_rpc_invalid_quantity');
  return BigInt(value).toString();
}
function block(value: unknown): {number: string; hash: string; timestamp: number} {
  requireThat(value && typeof value === 'object' && !Array.isArray(value), 'evm_rpc_invalid_block');
  const v = value as Record<string,unknown>;
  const n = quantity(v.number), time = BigInt(quantity(v.timestamp));
  requireThat(typeof v.hash === 'string' && /^0x[0-9a-f]{64}$/.test(v.hash) && time <= BigInt(Number.MAX_SAFE_INTEGER), 'evm_rpc_invalid_block');
  return {number: toQuantity(BigInt(n)), hash: v.hash, timestamp: Number(time)};
}
function word(value: unknown): string {
  requireThat(typeof value === 'string' && /^0x[0-9a-f]{64}$/.test(value), 'evm_rpc_invalid_token_result'); return BigInt(value).toString();
}
function bytes(value: unknown, maximum: number): string {
  requireThat(typeof value === 'string' && /^0x([0-9a-f]{2})*$/.test(value) && value.length <= maximum * 2 + 2, 'evm_rpc_invalid_bytes'); return value;
}

/** Bounded, non-retrying RPC transport. Endpoint selection belongs to trusted wallet policy. */
export class EvmRpc {
  readonly #endpoint: string;
  constructor(endpoint: string, private readonly fetcher: typeof fetch = globalThis.fetch) {
    let url: URL; try {url = new URL(endpoint);} catch {throw new ProtocolError('evm_invalid_rpc_endpoint');}
    requireThat(url.protocol === 'https:' && !url.username && !url.password && !url.hash && endpoint.length <= 2048, 'evm_invalid_rpc_endpoint');
    this.#endpoint = url.href;
  }
  async request(method: string, params: unknown[], signal: AbortSignal): Promise<unknown> {
    requireThat(!signal.aborted, 'evm_rpc_cancelled');
    requireThat(methods.has(method) && Array.isArray(params) && params.length <= 3, 'evm_rpc_unsupported_method');
    const id = random(12), body = JSON.stringify({jsonrpc:'2.0',id,method,params});
    requireThat(new TextEncoder().encode(body).length <= 36_000, 'evm_rpc_request_too_large');
    try {
      const response = await this.fetcher(this.#endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body,credentials:'omit',redirect:'error',cache:'no-store',signal:AbortSignal.any([signal,AbortSignal.timeout(15000)])});
      if(!response.ok) {
        await response.body?.cancel().catch(()=>{});
        throw new EvmRpcHttpError(method,response.status);
      }
      const reader = response.body?.getReader(); requireThat(reader, 'evm_rpc_empty_response');
      const chunks: Uint8Array[] = []; let size = 0;
      try {for (;;) {const part = await reader.read(); if(part.done)break; size += part.value.length; requireThat(size <= 262144, 'evm_rpc_response_too_large'); chunks.push(part.value);}}
      finally {await reader.cancel();}
      const data = new Uint8Array(size);let offset=0;for(const c of chunks){data.set(c,offset);offset+=c.length;}
      const parsed = parseJSON(new TextDecoder('utf-8',{fatal:true}).decode(data),262144);
      requireThat(parsed && typeof parsed === 'object' && !Array.isArray(parsed), 'evm_rpc_invalid_response');
      const value=parsed as Record<string,unknown>;
      requireThat(value.jsonrpc==='2.0' && value.id===id, 'evm_rpc_response_mismatch');
      if(Object.hasOwn(value,'error')) {
        const error=value.error;
        const code=error&&typeof error==='object'&&!Array.isArray(error)?(error as Record<string,unknown>).code:null;
        throw new EvmRpcError(method,typeof code==='number'&&Number.isSafeInteger(code)?code:null);
      }
      record(value,['jsonrpc','id','result']);
      return value.result;
    } catch(error) {
      // Raw provider errors can echo signed bytes, addresses, endpoint credentials or params.
      if(error instanceof ProtocolError)throw error;
      throw new ProtocolError('evm_rpc_delivery_unknown');
    }
  }
  async inspect(plan: Readonly<EvmPlan>, signal: AbortSignal): Promise<EvmState> {
    const [chain, first, current, nonce] = await Promise.all([
      this.request('eth_chainId',[],signal),this.request('eth_getBlockByNumber',['0x0',false],signal),
      this.request('eth_getBlockByNumber',['latest',false],signal),this.request('eth_getTransactionCount',[plan.from,'pending'],signal)
    ]);
    const genesis=block(first),latest=block(current);
    requireThat(genesis.number==='0x0','evm_rpc_invalid_genesis');
    // EIP-1898 binds state reads to one canonical block. Unsupported providers fail closed.
    const at={blockHash:latest.hash,requireCanonical:true},tx=Transaction.from(plan.unsignedSerialized);
    const call={from:plan.from,to:plan.to,nonce:toQuantity(tx.nonce),gas:toQuantity(tx.gasLimit),value:toQuantity(tx.value),data:tx.data,
      ...(tx.type===0?{gasPrice:toQuantity(tx.gasPrice!)}:{maxFeePerGas:toQuantity(tx.maxFeePerGas!),maxPriorityFeePerGas:toQuantity(tx.maxPriorityFeePerGas!)})};
    const readToken=(method:'balanceOf'|'allowance',args:string[])=>this.request('eth_call',[{from:plan.from,to:plan.to,data:tokenRead.encodeFunctionData(method,args)},at],signal).then(word);
    const [balance,senderCode,destinationCode,destinationBalance,destinationNonce,simulation,tokenBalance,allowance]=await Promise.all([
      this.request('eth_getBalance',[plan.from,at],signal),this.request('eth_getCode',[plan.from,at],signal),
      this.request('eth_getCode',[plan.to,at],signal),this.request('eth_getBalance',[plan.to,at],signal),
      this.request('eth_getTransactionCount',[plan.to,at],signal),this.request('eth_call',[call,at],signal),
      plan.kind==='erc20-transfer'?readToken('balanceOf',[plan.from]):Promise.resolve(null),
      plan.kind==='erc20-approval'?readToken('allowance',[plan.from,plan.recipient]):Promise.resolve(null)
    ]);
    const [chainAgain,canonicalBlock]=await Promise.all([this.request('eth_chainId',[],signal),this.request('eth_getBlockByNumber',[latest.number,false],signal)]);
    const canonicalHead=block(canonicalBlock);
    requireThat(chainAgain===chain && canonicalHead.hash===latest.hash && canonicalHead.number===latest.number,'evm_rpc_state_changed');
    return {chainId:quantity(chain),genesisHash:genesis.hash,blockHash:latest.hash,blockTimestamp:latest.timestamp,observedAt:nowSeconds(),pendingNonce:quantity(nonce),balance:quantity(balance),senderCode:bytes(senderCode,65536),destinationCode:bytes(destinationCode,65536),destinationBalance:quantity(destinationBalance),destinationNonce:quantity(destinationNonce),tokenBalance,allowance,simulationReturn:bytes(simulation,256)};
  }
  async broadcast(signed: string, signal: AbortSignal): Promise<string> {
    bytes(signed,8192);
    const value=await this.request('eth_sendRawTransaction',[signed],signal);
    requireThat(typeof value==='string' && /^0x[0-9a-f]{64}$/.test(value),'evm_rpc_invalid_transaction_hash');return value;
  }
}
