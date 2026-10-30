# BNB Smart Chain testnet fixture

This standalone fixture uses the restricted reusable `@oathconnect/evm` adapter
with chain ID 97 and a pinned BSC testnet genesis/official RPC endpoint. It has no
mainnet mode, arbitrary endpoint, token call or transaction input. It has not yet
completed a funded transfer. Host tests are not network qualification.

From a clean checkout after `npm ci --ignore-scripts` and `npm run build`:

```sh
node --test labs/bnb/*.test.mjs
node labs/bnb/run.mjs
```

The process generates a fresh in-memory signer and prints only a public funding
address. It waits up to 20 minutes for free testnet funding, then performs one
fixed transfer of **one wei of testnet BNB** to the public test sink address
`0x00000000000000000000000000000000deadbeef`. That address is already funded
on testnet; no existing user wallet is used. The legacy EIP-155 transaction fixes
the nonce at zero, gas at 21,000 and gas price at 1 gwei. Its maximum total debit
is 21,000,000,000,001 wei. Account creation, delegated accounts, contracts and
additional fee models are rejected.

The adapter checks pinned network/state and unsigned simulation before approval,
before signing and after signing. The fixture additionally rechecks the network
immediately before its single submission. It preserves the public hash before
dispatch. An ambiguous result never causes resubmission or a replacement signer
within that run. Ctrl-C stops the fixture and deletes its temporary public
funding file; its private key never leaves the process.

Receipt checks require the exact hash, type, sender, recipient, success status,
21,000 gas, fixed gas price, no logs or contract creation, and the expected sender
and recipient balance changes between canonical block snapshots. Concurrent
third-party transfers involving the public test sink address can cause a conservative
qualification failure. Finality checks compare canonical block identities and
the RPC's `finalized` height. This is a provider assertion, not independent
consensus proof.

`OATHCONNECT_LIVE_VALIDATION=true node labs/bnb/run.mjs` uses the deployed relay
only with a separately configured, approved, temporary test issuer and exact
source/deployment match. The currently published registry has no enabled project.

Read-only reconciliation can later verify a recorded hash and saved balance
snapshot, including an interrupted or uncertain attempt:

```sh
node labs/bnb/reconcile.mjs local
# or: node labs/bnb/reconcile.mjs live
```

Evidence preserves run history; keys and signed transaction bytes are not stored.
The fixture does not integrate Oath Wallet or establish THORChain swap support.

Primary references checked 2026-10-30:

- [Official endpoints and chain ID](https://docs.bnbchain.org/bnb-smart-chain/developers/json_rpc/json-rpc-endpoint/)
- [BSC finality API](https://docs.bnbchain.org/bnb-smart-chain/developers/json_rpc/bsc-api-list/)
- [Official faucet](https://www.bnbchain.org/en/testnet-faucet) currently requires a mainnet BNB balance; it is unsuitable for these fresh disposable accounts.
- [Chainstack faucet](https://faucet.chainstack.com/bnb-testnet-faucet) also lists mainnet balance/history requirements. No mainnet funds are authorized or used.
