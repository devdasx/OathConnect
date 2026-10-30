# Fixed Solana test-network qualification

This is a standalone **test fixture**, not a general-purpose Solana adapter or
Oath Wallet integration. It accepts only one legacy message: one signer, three
accounts and one System Program transfer of exactly 0.001 test-network SOL to a newly
generated disposable account. Versioned messages, extra instructions, tokens,
program calls, durable nonces and imported wallets are unsupported.

From a clean checkout, run `npm ci --ignore-scripts`, `npm run build`, then
`node labs/solana/run.mjs` for devnet, or `node labs/solana/run.mjs testnet` for
the separate Solana testnet cluster. Fund the printed public address with free SOL
on that exact cluster during its 20-minute window. Both keys stay in process memory. The temporary
file contains only the public funding address and expiry and is removed at exit.
There is no mainnet or custom-endpoint mode. Both choices have immutable endpoint,
genesis and capability pins. Testnet can run different software from devnet;
a pass on one does not certify the other. The original RPC airdrop attempt returned HTTP 410;
the fixture now waits for external free funding instead of repeatedly calling it.
See the [Solana Foundation faucet guide](https://solana.com/developers/cookbook/development/airdrops-and-faucets).

The fixture pins the selected cluster's genesis and checks account ownership/data, recipient
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
establish live network qualification. A funded run from clean commit
`14d61fc6cbb278509adf278e5d49fe78b699e354` completed through the local relay in
devnet slot 516914340 with one approval, signature and submission. See the
[receipt](../../evidence/solana-devnet.json) and
[free funding evidence](../../evidence/solana-devnet-funding.json).

Run `node labs/solana/reconcile.mjs local` (or `live`) to check the retained
public signature at finalized commitment without signing or sending again.
Add `testnet` as the final argument for that cluster's separate evidence.
It verifies the signature, fixed transfer, receipt effects and agreement with
the provider's finalized signature status. It stores only filtered public
evidence, never the signed transaction bytes. This is one RPC provider's
assertion of finality, not independent consensus proof. A missing receipt is
not permission to resubmit. A separate testnet transfer completed through the
deployed relay at clean commit `dce6883578afdb8d91584a9f70b625b1b71bb3fa`, in
slot 458656746, with one approval/signature/submission and a 5,000-lamport fee.
See the [live testnet receipt](../../evidence/solana-testnet-live.json) and
[free funding evidence](../../evidence/solana-testnet-funding.json). This is a
different cluster from the local devnet transfer. Its
[read-only finality check](../../evidence/solana-testnet-live-finality.json)
passed without another submission. The unfunded
deployed-devnet process was stopped before pairing/signing when alternative funding
was unavailable; see [attempt](../../evidence/solana-devnet-live.json). Deployed
devnet testing, tokens/programs and a general-purpose Solana adapter remain open.

Primary references:

- [Solana transaction structure](https://solana.com/docs/core/transactions)
- [Distinct clusters and official endpoints](https://solana.com/docs/references/clusters)
- [Simulation and signature verification](https://solana.com/docs/rpc/http/simulatetransaction)
- [Confirmed transaction lookup](https://solana.com/docs/rpc/http/gettransaction)
