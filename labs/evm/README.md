# Sepolia qualification fixture

Run `npm ci --ignore-scripts`, `npm run build`, then `node labs/evm/run.mjs`
from the repository root. Use a clean commit for attributable evidence. The
fixture pins Ethereum Sepolia chain ID 11155111 and its genesis hash. There is
no mainnet option and no wallet key import. A disposable key lives only in the
process; only its public funding address is written to a temporary file.

Fund that address with free Sepolia ETH during the bounded 20-minute wait.
The [Ethereum network documentation](https://ethereum.org/developers/docs/networks/)
lists faucets. The fixture needs 0.000021000000000001 Sepolia ETH at its fixed
fee cap. Do not buy funds or use an existing wallet. Unused test funds remain
in the disposable account when the process ends; the key is not saved.

The fixed test policy permits exactly one EIP-1559 native transfer of one wei
to a previously generated and funded disposable account, 21,000 gas, a 1-gwei maximum fee and 0.1-gwei tip.
It uses the reusable EVM adapter, encrypted session and digest-bound approval.
Approval is automated for these exact fixture parameters, not a user-interface
test. It checks a successful canonical receipt, the EIP-7708 system Transfer log,
and recipient balance delta.
Canonical inclusion is recorded separately from consensus finality.

Evidence archives retain failed attempts and the transaction hash before
submission. A failed or interrupted submission must be reconciled by hash;
the runner never retries it. A new run creates another disposable account.
Keys, raw transactions, grants and pairing secrets are never printed or saved.

The first funded run rejected before approval/signing because Sepolia activated
Glamsterdam on October 6, 2026: creating a new recipient account now costs
additional state gas. The attempted run remains in the evidence archive. The
current fixture uses that run's funded disposable sender as its recipient; its
key was discarded, and it is not a user wallet. The adapter now explicitly
checks recipient existence and rejects zero-value/self transfers. These cases
need separate gas-policy qualification; increasing gas is not an automatic fix.

By default the relay is local Cloudflare workerd. Deployed testing uses the
separate one-hour validation workflow described in `docs/DEPLOYMENT.md` and
requires `OATHCONNECT_LIVE_VALIDATION=true`; it checks deployed commit and
registry identity and records a separate live evidence file.

The read-only genesis check found the public PublicNode endpoint pruned below
block 1,000,000 on 2026-10-30. This fixture uses Tenderly's public
Sepolia endpoint for state inspection, listed in [ChainList](https://chainlist.org/chain/11155111).
It still requires genesis history and EIP-1898; no identity check is bypassed.
The pinned genesis also appears in
[go-ethereum's chain configuration](https://github.com/ethereum/go-ethereum/blob/master/params/config.go).

A funded attempt received an HTTP failure when submitting through Tenderly;
the original transaction remains uncertain and is never retried. Starting with
the 0.3.0-alpha.2 fixture, fresh accounts use
[PublicNode's published Sepolia endpoint](https://ethereum.publicnode.com/?sepolia)
for their single submission, after checking its chain ID. This is a configured
endpoint for a new attempt, not automatic fallback or failover. Receipt checking
continues through the archive reader. HTTP errors retain only method/status;
JSON-RPC rejections retain only method/numeric code. Neither proves non-delivery.

Free funding was obtained from [OpenFaucet](https://openfaucet.org/ethereum-sepolia)
without a mainnet balance. Its browser computation was stopped at claim time.
Funding receipts are separate from OathConnect transaction confirmation.

This does not qualify ERC-20 contracts, other EVM networks, THORChain swaps,
Oath Wallet, or production use.
