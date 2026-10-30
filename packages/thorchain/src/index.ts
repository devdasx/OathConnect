import {integer, nowSeconds, parseJSON, ProtocolError, requireThat} from '@oathconnect/protocol';

export interface Inbound {chain: string; address: string; halted: boolean; global_trading_paused: boolean; chain_trading_paused: boolean}
export interface SwapInput {fromAsset: string; toAsset: string; amount: string; destination: string; maxSlippageBps: number}
export interface QuoteReview {inboundAddress: string; memo: string; expires: number; expectedOut: string; minimumOut: string; dustThreshold: string; fromAsset: string; toAsset: string; amount: string; destination: string}
const amount = (value: unknown): value is string => typeof value === 'string' && /^[0-9]{1,30}$/.test(value);
const asset = (value: string) => /^[A-Z0-9]{2,10}\.[A-Za-z0-9_-]{1,100}$/.test(value);
export function reviewQuote(value: unknown, input: SwapInput, inbound: Inbound, now = nowSeconds()): QuoteReview {
  requireThat(asset(input.fromAsset) && asset(input.toAsset) && amount(input.amount) && BigInt(input.amount) > 0n && /^[A-Za-z0-9_-]{8,128}$/.test(input.destination), 'invalid_swap_input');
  integer(input.maxSlippageBps, 1, 1000);
  requireThat(inbound.chain === input.fromAsset.split('.')[0] && inbound.halted === false && inbound.global_trading_paused === false && inbound.chain_trading_paused === false, 'chain_halted_or_unknown');
  requireThat(value && typeof value === 'object' && !Array.isArray(value), 'invalid_quote');
  const q = value as Record<string, unknown>;
  requireThat(!q.error && q.inbound_address === inbound.address, 'inbound_mismatch');
  integer(q.expiry, now + 1, now + 600);
  requireThat(amount(q.expected_amount_out) && BigInt(q.expected_amount_out) > 0n && amount(q.dust_threshold), 'invalid_quote_amount');
  // Quote amount uses 1e8 units. Native-chain dust comparisons belong in the wallet's chain decoder.
  requireThat(typeof q.memo === 'string' && q.memo.length <= 512, 'invalid_memo');
  const parts = q.memo.split(':');
  // The example intentionally supports only direct swaps, no affiliates, THORNames or custom refunds.
  requireThat(parts.length === 4 && parts[0] === '=' && parts[1] === input.toAsset && parts[2] === input.destination && /^[0-9]{1,30}(\/[0-9]{1,5}\/[0-9]{1,5})?$/.test(parts[3]!), 'unsupported_or_modified_memo');
  const minimum = parts[3]!.split('/')[0]!;
  requireThat(BigInt(minimum) > 0n && BigInt(minimum) * 10000n >= BigInt(q.expected_amount_out) * BigInt(10000 - input.maxSlippageBps), 'missing_slippage_protection');
  if (['BTC', 'LTC', 'BCH', 'DOGE'].includes(inbound.chain)) requireThat(new TextEncoder().encode(q.memo).length <= 80, 'memo_too_long');
  return Object.freeze({inboundAddress: inbound.address, memo: q.memo, expires: q.expiry, expectedOut: q.expected_amount_out, minimumOut: minimum, dustThreshold: q.dust_threshold, ...input});
}
export class ThorchainClient {
  constructor(private readonly base = 'https://gateway.liquify.com/chain/thorchain_api', private readonly fetcher: typeof fetch = globalThis.fetch) {
    const url = new URL(base); requireThat(url.protocol === 'https:' && !url.username && !url.password && !url.search && !url.hash && !base.endsWith('/'), 'invalid_thornode');
  }
  async #get(path: string): Promise<unknown> {
    const response = await this.fetcher(this.base + path, {redirect: 'error', credentials: 'omit', cache: 'no-store', signal: AbortSignal.timeout(10_000)});
    requireThat(response.ok, 'thornode_unavailable');
    const reader = response.body?.getReader(); requireThat(reader, 'empty_response');
    let total = 0; const chunks: Uint8Array[] = [];
    try {for (;;) {const part = await reader.read(); if (part.done) break; total += part.value.length; requireThat(total <= 128_000, 'response_too_large'); chunks.push(part.value);}}
    finally {await reader.cancel();}
    const data = new Uint8Array(total); let offset = 0; for (const chunk of chunks) {data.set(chunk, offset); offset += chunk.length;}
    return parseJSON(new TextDecoder('utf-8', {fatal:true}).decode(data), 128_000);
  }
  async inbounds(): Promise<Inbound[]> {
    const values = await this.#get('/thorchain/inbound_addresses'); requireThat(Array.isArray(values) && values.length <= 64, 'invalid_inbounds');
    const seen = new Set<string>();
    return values.map(v => {
      requireThat(v && typeof v === 'object' && typeof v.chain === 'string' && /^[A-Z0-9]{2,10}$/.test(v.chain) && !seen.has(v.chain), 'invalid_chain'); seen.add(v.chain);
      requireThat(typeof v.address === 'string' && v.address.length > 0 && v.address.length <= 256, 'invalid_inbound_address');
      for (const field of ['halted','global_trading_paused','chain_trading_paused']) requireThat(typeof v[field] === 'boolean', 'unknown_halt_state');
      return {chain:v.chain, address:v.address, halted:v.halted, global_trading_paused:v.global_trading_paused, chain_trading_paused:v.chain_trading_paused};
    });
  }
  async quote(input: SwapInput): Promise<QuoteReview> {
    requireThat(asset(input.fromAsset) && asset(input.toAsset) && amount(input.amount) && BigInt(input.amount) > 0n && /^[A-Za-z0-9_-]{8,128}$/.test(input.destination), 'invalid_swap_input');
    integer(input.maxSlippageBps, 1, 1000);
    const inbounds = await this.inbounds();
    const source = inbounds.find(i => i.chain === input.fromAsset.split('.')[0]);
    const target = inbounds.find(i => i.chain === input.toAsset.split('.')[0]);
    for (const chain of [source, target]) requireThat(chain && !chain.halted && !chain.chain_trading_paused && !chain.global_trading_paused, 'chain_halted_or_unknown');
    const query = new URLSearchParams({from_asset: input.fromAsset, to_asset:input.toAsset, amount:input.amount, destination:input.destination, liquidity_tolerance_bps:String(input.maxSlippageBps), streaming_interval:'1'});
    const quote = await this.#get('/thorchain/quote/swap?' + query);
    if (!source) throw new ProtocolError('unsupported_chain');
    return reviewQuote(quote, input, source);
  }
}
