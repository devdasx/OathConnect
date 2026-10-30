# OathConnect EVM preview

`@oathconnect/evm` implements a restricted transaction adapter for the TypeScript
wallet SDK. It is a development preview, has not received an independent security
audit, and is not approved for real funds. It does not integrate Oath Wallet.

## Accepted operations

- Fully populated `eth_sendTransaction`: replay-protected legacy (type 0) and
  EIP-1559 (type 2), with exact chain, sender, recipient, nonce, gas and fees.
- Positive native transfers to a different, already existing account, with empty
  calldata and exactly 21,000 gas. New-account, zero-value and self transfers
  are excluded. Both sender and
  destination must have no code; reserved low addresses are rejected.
- Canonical ERC-20 `transfer` and `approve` calls to wallet-allowlisted bytecode.
  Approval amounts are capped by wallet policy, and a nonzero allowance must be
  reset to zero before setting another nonzero allowance.

Amounts and fees use lossless integer strings. Contract deployment, arbitrary
calls, router swaps, message signing, permits, access lists, blobs, EIP-7702
authorizations/delegation and unknown fields are rejected. This includes
THORChain router calls: the package does not yet implement a THORChain swap.

## Wallet integration boundary

Construct `EvmAdapter(policy, hooks)` and register it for the exact
`eip155:<chainId>/eth_sendTransaction` capability in `WalletAuthorizer`.
The wallet supplies trusted policy, approval UI and a signing engine. Website
input must never choose that policy, an RPC endpoint, token metadata or a key.

`EvmRpc` supplies bounded HTTPS `inspect` and single-attempt `broadcast` methods.
Pass them with closures to preserve their receiver. The signing hook receives
the reviewed unsigned serialized transaction and an `ExecutionContext`; it must
sign only, enforce wallet locking, and never submit a transaction itself.
The adapter recovers the signing address and compares every unsigned field
before broadcasting. It rechecks network state before and after signing.

The wallet must qualify each network's fee model. This version supports only
networks using 18-decimal native units whose total gas fee is bounded by
`gasLimit × gasPrice` (legacy) or `gasLimit × maxFeePerGas` (EIP-1559).
Select `feeModel: "gas-limit-times-price"` only after wallet qualification.
This bound includes state gas charged within the transaction gas limit. Rollup data fees and
other network-specific charges require a different adapter. A chain ID alone
does not establish support. Policy caps are per transaction, not a daily budget.

Keep one adapter and a wallet-owned nonce coordinator for each account/network
across sessions. The in-memory attempted-nonce set is bounded to 1,024 and is
not durable across process restarts. A replacement adapter is not permission to
repeat an uncertain request. Reconcile chain state before explicitly starting
a new attempt. No private key persistence or account-wide nonce service is
included.

## Trust and cancellation

The reader pins chain ID and genesis, binds state reads to a single canonical
block with EIP-1898, and checks freshness, balance, pending nonce, sender code,
destination code and simulation results. Native recipients must have a nonzero balance or nonce at the inspected block.
EIP-2780/EIP-8037 change intrinsic/state gas; the restricted positive transfer
to an existing different account uses all 21,000 execution gas. Empty accounts
and transfers with cheaper intrinsic costs need separate qualification.
Providers without genesis history or
EIP-1898 support fail closed. These are RPC assertions, not consensus proofs;
an untrusted or compromised provider can lie. Run or independently verify trusted
infrastructure for production qualification.

A token runtime-code hash is not an audit of its behavior or a proxy's
implementation/storage. Wallet token policy needs independent review and an
update/revocation process. A successful simulation cannot guarantee future
execution or stop another pending transaction from changing state.

Every asynchronous signer must check `context.assertActive()` after waits and
immediately before key use. The adapter checks it again before broadcast and
passes `context.signal` to network calls. Closing or expiring a request prevents
later dispatch; it cannot recall a signature or submission already made.

`submitted` means the RPC returned the expected locally computed transaction
hash, not that the transaction is confirmed. `broadcast_unknown` means delivery
may have occurred; preserve its hash and reconcile receipts without rebroadcasting.
Never retry automatically. Production applications need durable, privacy-safe
submission tracking before key use. The connection layer does not provide it.

## Validation and sources

Adversarial host tests cover exact bytes, unsafe quantities, changed signatures,
network/state changes, code pins, allowance rules, cancellation and ambiguous
delivery. Live network evidence, when present, is separately recorded under
`evidence`; mock token tests do not qualify a token or a network.

- [EIP-1559](https://eips.ethereum.org/EIPS/eip-1559)
- [EIP-1898](https://eips.ethereum.org/EIPS/eip-1898)
- [ERC-20](https://eips.ethereum.org/EIPS/eip-20)
- [EIP-7702](https://eips.ethereum.org/EIPS/eip-7702)
- [ethers transaction API](https://docs.ethers.org/v6/api/transaction/)

- [Sepolia Glamsterdam activation](https://blog.ethereum.org/2026/09/17/glamsterdam-testnet-announcement)
- [EIP-2780](https://eips.ethereum.org/EIPS/eip-2780)
- [EIP-8037](https://eips.ethereum.org/EIPS/eip-8037)
- [EIP-7708](https://eips.ethereum.org/EIPS/eip-7708)
