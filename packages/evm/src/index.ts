import {getAddress, Interface, keccak256, Transaction, formatUnits} from 'ethers';
import {canonical, digest, integer, nowSeconds, ProtocolError, record, requireThat} from '@oathconnect/protocol';
import type {ExecutionContext, Review, SigningRequest, WalletAdapter} from '@oathconnect/sdk';
export {EvmRpc, EvmRpcError, EvmRpcHttpError} from './rpc.js';

const UINT256 = (1n << 256n) - 1n;
const erc20 = new Interface(['function transfer(address to,uint256 amount) returns (bool)', 'function approve(address spender,uint256 amount) returns (bool)']);
const trueWord = '0x' + '0'.repeat(63) + '1';

export interface TokenPolicy {
  readonly address: string;
  /** Wallet-reviewed runtime bytecode hash. This does not attest proxy implementation/storage. */
  readonly codeHash: string;
  readonly symbol: string;
  readonly decimals: number;
  /** Zero disables new spending allowances, but permits revocation. Base units. */
  readonly maximumApproval: string;
}
export interface EvmPolicy {
  readonly chainId: string;
  readonly genesisHash: string;
  readonly account: string;
  readonly nativeSymbol: string;
  /** Explicit wallet qualification; rollup/L1-data-fee networks need another adapter. */
  readonly feeModel: 'gas-limit-times-price';
  readonly maximumGas: string;
  readonly maximumFeePerGas: string;
  readonly maximumGasFee: string;
  readonly maximumValue: string;
  readonly maximumBlockAge: number;
  readonly tokens: readonly TokenPolicy[];
}
export interface EvmPlan {
  readonly chainId: string;
  readonly from: string;
  readonly to: string;
  readonly nonce: string;
  readonly gas: string;
  readonly value: string;
  readonly maximumGasFee: string;
  readonly unsignedSerialized: string;
  readonly kind: 'native-transfer' | 'erc20-transfer' | 'erc20-approval';
  readonly recipient: string;
  readonly amount: string;
  readonly token: Readonly<TokenPolicy> | null;
}
/** Returned by the wallet's trusted network reader, never supplied by the website. */
export interface EvmState {
  readonly chainId: string;
  readonly genesisHash: string;
  readonly blockHash: string;
  readonly blockTimestamp: number;
  readonly observedAt: number;
  readonly pendingNonce: string;
  readonly balance: string;
  readonly senderCode: string;
  readonly destinationCode: string;
  readonly destinationBalance: string;
  readonly destinationNonce: string;
  readonly tokenBalance: string | null;
  readonly allowance: string | null;
  readonly simulationReturn: string;
}
export interface EvmHooks {
  /** Use pinned network configuration and one block for code/balance/call reads. */
  inspect(plan: Readonly<EvmPlan>, signal: AbortSignal): Promise<EvmState>;
  /** Sign only; this hook must not broadcast. Wallet locking must be enforced here. */
  sign(unsignedSerialized: string, context: Readonly<ExecutionContext>): Promise<string>;
  /** One submission, no retries. A thrown error means the delivery may be unknown. */
  broadcast(signedSerialized: string, signal: AbortSignal): Promise<string>;
}

function decimal(value: unknown, maximum = UINT256): bigint {
  requireThat(typeof value === 'string' && /^(0|[1-9][0-9]{0,77})$/.test(value), 'evm_invalid_integer');
  const result = BigInt(value); requireThat(result <= maximum, 'evm_integer_overflow'); return result;
}
function quantity(value: unknown, maximum = UINT256): bigint {
  requireThat(typeof value === 'string' && /^0x(0|[1-9a-f][0-9a-f]{0,63})$/.test(value), 'evm_invalid_quantity');
  const result = BigInt(value); requireThat(result <= maximum, 'evm_integer_overflow'); return result;
}
function address(value: unknown): string {
  requireThat(typeof value === 'string' && /^0x[0-9a-fA-F]{40}$/.test(value), 'evm_invalid_address');
  try {return getAddress(value);} catch {throw new ProtocolError('evm_invalid_checksum');}
}
function hex(value: unknown, maximum: number): asserts value is string {
  requireThat(typeof value === 'string' && /^0x([0-9a-f]{2})*$/.test(value) && value.length <= 2 + maximum * 2, 'evm_invalid_bytes');
}
function hash(value: unknown): asserts value is string {
  requireThat(typeof value === 'string' && /^0x[0-9a-f]{64}$/.test(value), 'evm_invalid_hash');
}
function freeze<T>(value: T): T {
  if (value && typeof value === 'object') {Object.values(value).forEach(freeze); Object.freeze(value);}
  return value;
}
function policySnapshot(value: EvmPolicy): Readonly<EvmPolicy> {
  const policy = JSON.parse(canonical(value)) as EvmPolicy;
  record(policy, ['chainId','genesisHash','account','nativeSymbol','feeModel','maximumGas','maximumFeePerGas','maximumGasFee','maximumValue','maximumBlockAge','tokens']);
  requireThat(policy.feeModel === 'gas-limit-times-price', 'evm_unqualified_fee_model');
  requireThat(decimal(policy.chainId) > 0n && policy.chainId.length <= 32, 'evm_invalid_chain'); hash(policy.genesisHash); address(policy.account);
  requireThat(typeof policy.nativeSymbol === 'string' && /^[A-Z0-9]{1,12}$/.test(policy.nativeSymbol), 'evm_invalid_symbol');
  requireThat(decimal(policy.maximumGas) >= 21_000n && decimal(policy.maximumGas) <= 100_000_000n, 'evm_gas_policy');
  requireThat(decimal(policy.maximumFeePerGas) > 0n && decimal(policy.maximumGasFee) > 0n, 'evm_fee_policy'); decimal(policy.maximumValue);
  integer(policy.maximumBlockAge, 5, 3600);
  requireThat(Array.isArray(policy.tokens) && policy.tokens.length <= 128, 'evm_token_policy');
  const seen = new Set<string>();
  for (const token of policy.tokens) {
    record(token, ['address','codeHash','symbol','decimals','maximumApproval']);
    const target = address(token.address); requireThat(!seen.has(target), 'evm_duplicate_token'); seen.add(target);
    hash(token.codeHash); requireThat(typeof token.symbol === 'string' && /^[A-Za-z0-9._-]{1,20}$/.test(token.symbol), 'evm_invalid_symbol');
    integer(token.decimals, 0, 36); decimal(token.maximumApproval, UINT256 - 1n);
  }
  return freeze(policy);
}

/** Strict, fully populated eth_sendTransaction parameters; no post-review fee/nonce filling. */
export function decodeEvmTransaction(request: Readonly<SigningRequest>, suppliedPolicy: EvmPolicy): Readonly<EvmPlan> {
  const policy = policySnapshot(suppliedPolicy);
  requireThat(request.chain === 'eip155:' + policy.chainId && request.method === 'eth_sendTransaction' && address(request.account) === address(policy.account), 'evm_wrong_capability');
  requireThat(Array.isArray(request.params) && request.params.length === 1, 'evm_invalid_params');
  const raw = request.params[0];
  requireThat(raw && typeof raw === 'object' && !Array.isArray(raw), 'evm_invalid_transaction');
  const type = raw.type;
  requireThat(type === '0x0' || type === '0x2', 'evm_unsupported_type');
  record(raw, ['type','chainId','from','to','nonce','gas','value','data',...(type === '0x0' ? ['gasPrice'] : ['maxFeePerGas','maxPriorityFeePerGas'])]);
  const chainId = quantity(raw.chainId), from = address(raw.from), to = address(raw.to);
  requireThat(chainId.toString() === policy.chainId && from === address(policy.account), 'evm_network_or_sender_mismatch');
  requireThat(to !== '0x0000000000000000000000000000000000000000', 'evm_zero_destination');
  const nonce = quantity(raw.nonce, BigInt(Number.MAX_SAFE_INTEGER)), gas = quantity(raw.gas), value = quantity(raw.value);
  hex(raw.data, 4096);
  const data = raw.data;
  requireThat(gas >= 21_000n && gas <= decimal(policy.maximumGas) && value <= decimal(policy.maximumValue), 'evm_spending_limit');
  const fee = quantity(type === '0x0' ? raw.gasPrice : raw.maxFeePerGas);
  requireThat(fee > 0n && fee <= decimal(policy.maximumFeePerGas) && fee * gas <= decimal(policy.maximumGasFee), 'evm_fee_limit');
  const tip = type === '0x2' ? quantity(raw.maxPriorityFeePerGas) : null;
  requireThat(tip === null || tip <= fee, 'evm_invalid_priority_fee');
  let kind: EvmPlan['kind'] = 'native-transfer', recipient = to, amount = value.toString(), token: TokenPolicy | null = null;
  if (data === '0x') {
    // Positive transfers to a different existing account consume all 21,000
    // execution gas under both the legacy schedule and EIP-2780. Zero-value
    // and self transfers leave execution gas under EIP-2780 and are excluded.
    requireThat(gas === 21_000n && value > 0n && from !== to && BigInt(to) > 65_535n, 'evm_native_transfer_policy');
  } else {
    token = policy.tokens.find(t => address(t.address) === to) ?? null;
    requireThat(token && value === 0n, 'evm_unapproved_contract');
    requireThat(data.length === 138 && ['0xa9059cbb','0x095ea7b3'].some(selector => data.startsWith(selector)), 'evm_unsupported_call');
    const method = data.startsWith('0xa9059cbb') ? 'transfer' : 'approve';
    try {
      const decoded = erc20.decodeFunctionData(method, data);
      requireThat(erc20.encodeFunctionData(method, decoded).toLowerCase() === data, 'evm_noncanonical_calldata');
      recipient = address(decoded[0]); amount = decimal(decoded[1].toString()).toString();
    } catch {throw new ProtocolError('evm_invalid_calldata');}
    requireThat(recipient !== '0x0000000000000000000000000000000000000000', 'evm_zero_destination');
    kind = method === 'transfer' ? 'erc20-transfer' : 'erc20-approval';
    if (kind === 'erc20-approval') requireThat(BigInt(amount) <= decimal(token.maximumApproval), 'evm_allowance_limit');
  }
  const transaction = Transaction.from({type: type === '0x0' ? 0 : 2, chainId, nonce: Number(nonce), to, gasLimit: gas, value, data,
    ...(type === '0x0' ? {gasPrice: fee} : {maxFeePerGas: fee, maxPriorityFeePerGas: tip!, accessList: []})});
  return freeze({chainId: policy.chainId, from, to, nonce: nonce.toString(), gas: gas.toString(), value: value.toString(), maximumGasFee: (fee * gas).toString(), unsignedSerialized: transaction.unsignedSerialized, kind, recipient, amount, token});
}

/** Recover the signer and compare every unsigned field before a signed payload may leave the wallet. */
export function verifyEvmSignature(plan: Readonly<EvmPlan>, signed: unknown): {hash: string; serialized: string} {
  hex(signed, 8192);
  try {
    const tx = Transaction.from(signed);
    requireThat(tx.isSigned() && tx.unsignedSerialized === plan.unsignedSerialized && tx.from === plan.from && tx.chainId.toString() === plan.chainId, 'evm_signed_transaction_changed');
    requireThat(tx.serialized === signed && tx.hash, 'evm_noncanonical_signed_transaction');
    return {hash: tx.hash, serialized: signed};
  } catch(error) {
    // Recovery/serialization getters can throw lazily after parsing. Never let
    // library errors expose signature or transaction values to host diagnostics.
    if(error instanceof ProtocolError)throw error;
    throw new ProtocolError('evm_invalid_signed_transaction');
  }
}

function inspectState(plan: Readonly<EvmPlan>, state: EvmState, policy: EvmPolicy): void {
  record(state, ['chainId','genesisHash','blockHash','blockTimestamp','observedAt','pendingNonce','balance','senderCode','destinationCode','destinationBalance','destinationNonce','tokenBalance','allowance','simulationReturn']);
  const now = nowSeconds();
  requireThat(state.chainId === plan.chainId && state.genesisHash === policy.genesisHash, 'evm_wrong_network'); hash(state.blockHash);
  integer(state.observedAt, now - 15, now + 5); integer(state.blockTimestamp, now - policy.maximumBlockAge, now + 5);
  requireThat(decimal(state.pendingNonce).toString() === plan.nonce, 'evm_nonce_changed');
  requireThat(decimal(state.balance) >= BigInt(plan.value) + BigInt(plan.maximumGasFee), 'evm_insufficient_balance');
  hex(state.senderCode, 65536); hex(state.destinationCode, 65536); hex(state.simulationReturn, 256);
  // EIP-7702 delegated accounts and contract recipients require a separate reviewed adapter.
  requireThat(state.senderCode === '0x', 'evm_delegated_sender');
  const destinationBalance=decimal(state.destinationBalance),destinationNonce=decimal(state.destinationNonce);
  if (plan.kind === 'native-transfer') {
    requireThat(state.destinationCode === '0x' && state.simulationReturn === '0x', 'evm_contract_destination');
    // Account creation has additional state-gas charges under EIP-8037. It needs
    // separate qualification; never raise gas automatically to make it succeed.
    requireThat(destinationBalance > 0n || destinationNonce > 0n, 'evm_native_account_creation_unsupported');
  } else {
    requireThat(plan.token && state.destinationCode !== '0x' && keccak256(state.destinationCode) === plan.token.codeHash, 'evm_token_code_changed');
    requireThat(state.simulationReturn === trueWord, 'evm_token_simulation_failed');
    if (plan.kind === 'erc20-transfer') requireThat(decimal(state.tokenBalance) >= BigInt(plan.amount), 'evm_token_balance');
    if (plan.kind === 'erc20-approval') requireThat(BigInt(plan.amount) === 0n || decimal(state.allowance) === 0n, 'evm_reset_allowance_first');
  }
}

export class EvmAdapter implements WalletAdapter {
  readonly #policy: Readonly<EvmPolicy>;
  readonly #reviewed = new Map<string, {plan: Readonly<EvmPlan>; expires: number}>();
  readonly #attemptedNonces = new Set<string>();
  #busy = false;
  constructor(policy: EvmPolicy, private readonly hooks: EvmHooks) {this.#policy = policySnapshot(policy);}
  async review(request: Readonly<SigningRequest>, context?: Readonly<ExecutionContext>): Promise<Review> {
    context?.assertActive();
    requireThat(!this.#busy, 'evm_busy');
    const plan = decodeEvmTransaction(request, this.#policy);
    const requestDigest = await digest(canonical(request));
    for (const [key, item] of this.#reviewed) if (item.expires <= nowSeconds()) this.#reviewed.delete(key);
    requireThat(this.#reviewed.size < 64 && !this.#attemptedNonces.has(plan.nonce), 'evm_repair_required');
    const state = await this.hooks.inspect(plan, context?.signal ?? AbortSignal.timeout(15_000)); context?.assertActive(); inspectState(plan, state, this.#policy);
    requireThat(!this.#busy && this.#reviewed.size < 64 && !this.#attemptedNonces.has(plan.nonce), 'evm_repair_required');
    requireThat(nowSeconds() < request.expires, 'evm_request_expired');
    this.#reviewed.set(requestDigest, {plan, expires: request.expires});
    const fee = formatUnits(plan.maximumGasFee, 18) + ' ' + this.#policy.nativeSymbol;
    const effect = plan.kind === 'native-transfer'
      ? `Send ${formatUnits(plan.value,18)} ${this.#policy.nativeSymbol} to ${plan.to}.`
      : plan.kind === 'erc20-transfer'
        ? `Request transfer of ${formatUnits(plan.amount,plan.token!.decimals)} ${plan.token!.symbol} to ${plan.recipient}. Token contract: ${plan.to}.`
        : `Set ${plan.token!.symbol} spending allowance for ${plan.recipient} to ${formatUnits(plan.amount,plan.token!.decimals)} (${plan.amount} base units). Token contract: ${plan.to}.`;
    return {requestDigest, summary: `${effect} Chain ID ${plan.chainId}; sender ${plan.from}; nonce ${plan.nonce}; maximum gas fee ${fee}.`,
      warnings: ['This adapter requires a wallet-qualified network whose fees are bounded by gas limit times price; rollup data fees and other network-specific charges are unsupported.',
        ...(plan.token ? ['Contract behavior depends on its implementation and state. A bytecode pin and successful simulation do not certify a token or proxy.'] : []),
        ...(plan.kind === 'erc20-approval' ? ['The spender can later transfer tokens up to this allowance without another OathConnect request.'] : [])]};
  }
  async execute(request: Readonly<SigningRequest>, context: Readonly<ExecutionContext>): Promise<{hash: string; status: 'submitted' | 'broadcast_unknown'}> {
    context.assertActive(); requireThat(!this.#busy, 'evm_busy');
    const requestDigest = await digest(canonical(request)), reviewed = this.#reviewed.get(requestDigest);
    requireThat(!this.#busy, 'evm_busy');
    requireThat(reviewed && reviewed.expires > nowSeconds(), 'evm_unreviewed_request');
    const {plan} = reviewed;
    requireThat(!this.#attemptedNonces.has(plan.nonce) && this.#attemptedNonces.size < 1024, 'evm_repair_required');
    this.#reviewed.delete(requestDigest); this.#busy = true;
    try {
      const before = await this.hooks.inspect(plan, context.signal); context.assertActive(); inspectState(plan, before, this.#policy);
      // Reserve before accessing keys. An uncertain signing attempt cannot reuse a nonce automatically.
      this.#attemptedNonces.add(plan.nonce); context.assertActive();
      let signed: string;
      try {signed = await this.hooks.sign(plan.unsignedSerialized, context);} catch {throw new ProtocolError('evm_signing_failed');}
      context.assertActive(); const verified = verifyEvmSignature(plan, signed);
      const after = await this.hooks.inspect(plan, context.signal); context.assertActive(); inspectState(plan, after, this.#policy);
      context.assertActive();
      try {
        const returned = await this.hooks.broadcast(verified.serialized, context.signal);
        return {hash: verified.hash, status: returned === verified.hash ? 'submitted' : 'broadcast_unknown'};
      } catch {return {hash: verified.hash, status: 'broadcast_unknown'};}
    } finally {this.#busy = false;}
  }
}
