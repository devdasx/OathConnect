# Fixed Solana devnet qualification

This is a standalone **test fixture**, not a general-purpose Solana adapter or
Oath Wallet integration. It accepts only one legacy message: one signer, three
accounts and one System Program transfer of exactly 0.001 devnet SOL to a newly
generated disposable account. Versioned messages, extra instructions, tokens,
program calls, durable nonces and imported wallets are unsupported.

From a clean checkout, run `npm ci --ignore-scripts`, `npm run build`, then
`node labs/solana/run.mjs`. Fund the printed public address with free devnet SOL
during its 20-minute window. Both keys stay in process memory. The temporary
file contains only the public funding address and expiry and is removed at exit.
There is no mainnet mode. The original RPC airdrop attempt returned HTTP 410;
the fixture now waits for external free funding instead of repeatedly calling it.
See the [Solana Foundation faucet guide](https://solana.com/developers/cookbook/development/airdrops-and-faucets).

The fixture pins devnet genesis and checks account ownership/data, recipient
absence, rent requirements, fee cap, blockhash validity and simulation before
approval, before signing and after signing. Exact decoded bytes are approved;
Node's Ed25519 implementation signs, and signature verification independently
checks the sender. Every simulation uses zeroed signatures and never replaces the blockhash.
Valid signed bytes are sent only at the final submission, after recording the
public signature. A provider receiving signed bytes could broadcast them,
regardless of the RPC method name. The
submission has `maxRetries: 0`; there is no automatic replacement or rebroadcast.
The public signature is recorded before the sole submission so an interrupted
or ambiguous result can be reconciled without sending again. Signed bytes and
provider messages/logs are never written to evidence or protocol replies.

Confirmation requires the RPC's exact signed transaction bytes, successful
execution, bounded fee and expected per-transaction sender/recipient/System
Program balance changes. The result identifies confirmed commitment separately
from finalized commitment. RPCs can lie; these checks are not consensus proof.
The fixture uses automated approval of its fixed parameters, not a wallet UI.

Every attempt is archived by `labs/support/evidence.mjs`. Local and deployed
runs have separate evidence names. The previous funding failure is preserved.
Deployed runs additionally require the temporary approval workflow described in
[deployment documentation](../../docs/DEPLOYMENT.md), a matching deployed
commit/registry, and `OATHCONNECT_LIVE_VALIDATION=true`. Disable the test approval
through GitHub afterward and remove its private issuer file.

Install the pinned comparison SDK with `npm ci --ignore-scripts --prefix labs/solana`,
then run host tests with `node --test labs/solana/*.test.mjs`. The cross-check
compares exact message bytes and signature verification against Solana Foundation
`@solana/web3.js` 3.1.1; it performs no network calls. These tests do not
establish live network qualification. No funded run of this revised fixture has
yet been completed.

Primary references:

- [Solana transaction structure](https://solana.com/docs/core/transactions)
- [Simulation and signature verification](https://solana.com/docs/rpc/http/simulatetransaction)
- [Confirmed transaction lookup](https://solana.com/docs/rpc/http/gettransaction)
