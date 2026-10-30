# Release readiness

Status: DEVELOPMENT PREVIEW. Production integration and real-funds use are blocked.

Required before changing this status:

- Completed, independently reviewed protocol and implementation with no unresolved critical/high findings.
- Browser/native interoperability, malformed-input, concurrency, replay, restart, expiry, revocation and resource-exhaustion tests.
- Wallet-specific transaction decoders and explicit approval UX validated for every enabled chain/method. Transport compatibility is not transaction-signing certification.
- Real testnet end-to-end evidence per chain, including transaction hashes and confirmed receipts; unavailable networks remain blocked, never marked passed.
- Verified GitHub-to-Cloudflare deployment, pinned dependencies/actions, secret handling, rollback, branch protection and release provenance.
- Operational capacity/load/abuse tests, incident response and recovery exercises.
- Independent security audit and remediation verification; a continuing vulnerability response process.

THORChain documentation retrieved 2026-10-30 describes stagenet endpoints as transitioning/TBD. THORChain stagenet can use real external assets; it is not a blanket authorization for free testnet spending. Sources: https://dev.thorchain.org/concepts/connecting-to-thorchain.html and https://docs.thorchain.org/thornodes/developing.

## Evidence at the 0.2 preview milestone

- Encrypted TypeScript sessions, issuer/peer authentication and per-request wallet approval are implemented and exercised in the local Cloudflare runtime.
- Swift pairing/ciphertext interoperability and digest-bound authorization pass host tests; the package compiles for generic iOS. Chrome 155 and the standalone Swift macOS 27 host completed authenticated pairing, independently verified peer identities, a wallet-selected capability, one digest-bound approval/execution and an encrypted Unicode reply through the deployed relay. See [receipt](../evidence/browser-native-live.json), [screenshot](../evidence/browser-native-live.png) and [reproducible fixture](../labs/browser-native/README.md). This was a fixed echo with no blockchain key; iOS runtime and other browser qualification remain open. No simulator or device checks were run.
- One disposable-account XRP Ledger Testnet payment was confirmed in ledger 21939918 through a local OathConnect session. See [receipt](../evidence/xrpl-testnet.json). A second payment succeeded through the deployed relay in ledger 21940233; see [live receipt](../evidence/xrpl-testnet-live.json). Neither payment is a THORChain swap. An earlier harness attempt rejected undefined optional fields before signing; the harness now explicitly normalizes the prepared transaction and reviews that exact snapshot.
- Read-only discovery observed 13 external THORChain chains. GAIA and SOL were halted at observation; GAIA and ZEC are absent from the current Oath catalog. The app catalog contains 42 chains. See the dated files in [evidence](../evidence).
- A fixed one-stroop Stellar Testnet payment completed through the local relay with one approval and one execution, confirmed in ledger 5470116. See [receipt](../evidence/stellar-testnet.json). This is not a deployed relay test or a general-purpose Stellar adapter. Earlier harness failures and subsequent receipt investigations are preserved in [attempts](../evidence/stellar-testnet-attempts.json), including one attempt whose broadcast status is unknown.
- A separate Stellar Testnet payment then completed through the deployed relay in ledger 5471013, again with one approval and execution. See [live receipt](../evidence/stellar-testnet-live.json). Both local and live receipts are preserved; neither is a THORChain swap or a general-purpose adapter qualification.
- A fixed one-MIST Sui Testnet address-balance transfer completed through the local relay with one approval and one execution, included in checkpoint 400942229. The fixture pins the testnet genesis, decodes the exact transaction, restricts the two framework calls and their inputs, caps the gas budget, simulates, and checks the confirmed recipient balance change. See [receipt](../evidence/sui-testnet.json) and [fixture](../labs/sui/run.mjs). This is not a deployed relay test or a general-purpose Sui adapter.
- A separate Sui Testnet transfer then completed through the deployed relay in checkpoint 400956792 with the same fixed policy and one approval/execution. See [live receipt](../evidence/sui-testnet-live.json). This does not certify other transaction types or a general-purpose signing adapter.
- Solana's original official free-funding request returned HTTP 410 before signing; its attempt is preserved in [run history](../evidence/solana-devnet-runs). A later free community faucet funded a fresh disposable account. Clean commit `14d61fc6cbb278509adf278e5d49fe78b699e354` completed the fixed 0.001 devnet SOL transfer through the local relay in slot 516914340, with one approval, signature and submission and a 5,000-lamport fee. See the [receipt](../evidence/solana-devnet.json) and [funding evidence](../evidence/solana-devnet-funding.json). A read-only reconciler checks the stored signature, receipt effects and provider-reported finalized status without resubmission. Deployed devnet testing, other Solana transaction types, remaining chains and every THORChain swap remain unverified. Generic chain identifiers do not establish adapter coverage.
- GitHub verification and deployment succeeded. Disposable one-hour validation identities were used for the live tests and are disabled in this registry. No third-party integrator is approved. Independent audit, load/abuse qualification and production approval remain open.

## EVM and execution context preview

The 0.3 preview adds a restricted reusable EVM adapter for native transfers and
wallet-allowlisted ERC-20 transfer/approval calls, with exact-byte signature
verification, network/state checks, bounded fees and single-attempt submission.
It requires wallet-qualified gas-limit-times-price fee bounds; rollups and other fee
models remain unsupported. See [adapter scope and trust limits](../packages/evm/README.md).
Host tests are not evidence of every EVM network or contract's behavior.

The funded Sepolia fixture first rejected a new recipient before approval or
signing because the network's account-creation gas requirements had changed.
The corrected fixture then reached one approval, signature and submission
attempt, but no receipt was returned. Two providers subsequently returned no
transaction or receipt and an unchanged sender nonce. This is an unconfirmed
attempt, not a passed test; the fixture did not resubmit. See the
[archived attempt](../evidence/evm-sepolia-runs/56ddce00-541f-4c30-a847-346913f9d7fc.json),
[read-only reconciliation](../evidence/evm-sepolia-reconciliation.json) and
[gas diagnosis](../evidence/evm-sepolia-diagnosis.json). The original attempt did
not retain the provider rejection code or submission result; subsequent fixture
code records only safe status, method and numeric error context.

A later fresh-account attempt isolated an HTTP failure at submission; see the
[archived failure](../evidence/evm-sepolia-runs/c73133dc-b43d-441d-afb7-306d1f18d945.json)
and [reconciliation](../evidence/evm-sepolia-http-reconciliation.json). Neither
uncertain transaction was retried. A separate account then completed one native
Sepolia transfer through the local relay, with one approval, one signature and
one PublicNode submission, confirmed in block 12028472. The fixture checked the
expected native-transfer log, 21,000 gas and one-wei recipient balance increase.
See the [receipt](../evidence/evm-sepolia.json) and
[cross-provider confirmation](../evidence/evm-sepolia-confirmation.json).
A fresh account also completed the same one-wei transfer through the deployed
relay at commit `8c06a27cf1167993428b0728237260ac53aab0fc`, confirmed in block
12028584. It again used one approval, one signature and one submission, with
the expected receipt, log and recipient balance change. See the
[live receipt](../evidence/evm-sepolia-live.json). This is a restricted native
transfer test, not ERC-20 or THORChain swap qualification.

`node labs/evm/reconcile.mjs local` (or `live`) checks the stored receipt with
two providers and writes separate dated finality evidence. Canonical inclusion
and provider-reported finalized height are distinct; neither proves consensus
independently. Both dated checks now place the confirmed transfers within the
providers' finalized heights. The disposable approval expired while the chat
was inactive, then its disabled registry deployed at
`14bc5d1d9dd953a1e501a499ca8741ccb521fd16`. Fresh signed grants were denied
both after expiry and after disabling; this is not a new within-lifetime
revocation test. The private issuer file was removed. See
[cleanup evidence](../evidence/evm-sepolia-live-cleanup.json).

ERC-20 qualification, broader operations and other networks
remain open.

TypeScript and Swift adapter/approval callbacks receive a request execution
context that becomes invalid on closure, expiry or completion. Cooperative checks
after asynchronous signing prevent subsequent broadcast. They cannot retract a
submission already dispatched. Wallet lock enforcement and durable reconciliation
of uncertain submissions remain integrator responsibilities.

The current source passed 48 TypeScript tests, including a global relay quota
regression: capacity-rejected allocation requests now count toward the request
budget. See [internal finding and repair](../evidence/security-quota-accounting-20261030.json).
Unchanged native sources passed
16 native SDK host tests, one native fixture host test and generic iOS
compilation at the 0.3.0-alpha.1 milestone. No simulator or physical device was
used. This is internal validation, not an independent audit.

## Solana development-network milestone

The fixed Solana fixture also completed a transfer through the deployed relay on
the separate Solana **testnet** cluster at clean commit
`dce6883578afdb8d91584a9f70b625b1b71bb3fa`, slot 458656746. It used one
approval, one signature, one submission, a 5,000-lamport fee and the expected
1,000,000-lamport recipient increase. See [receipt](../evidence/solana-testnet-live.json).
The [read-only finality check](../evidence/solana-testnet-live-finality.json)
verified the signature, fixed transaction and balance effects against the
provider's finalized receipt and signature status. This is one provider's
assertion, not independent consensus proof; the check made no submission.
The local transfer above was on **devnet**; these results are not a matched pair
on one cluster. Both faucets were free and all transaction keys remained in the
fixture processes. The temporary server approval was disabled through GitHub at
`9cf339942df6859b1092ac5db1cc6c76bdc1aefa`. A grant admitted before that
deployment was rejected after it while both the grant and project were still
within their original lifetimes. A fresh grant was also rejected. No project
remained enabled, and the private issuer file was removed. See
[revocation evidence](../evidence/solana-testnet-live-revocation.json).

All 21 Solana host tests pass, including cluster mismatch rejection and
read-only receipt/finality consistency checks. Internal AI review found no
actionable defects in the network-selection change; this is not an external
audit. Token/program methods, deployed devnet qualification and other chains
remain open. Read-only Avalanche Fuji and BNB testnet identity/EIP-1898 probes
passed; [those probes](../evidence/evm-additional-testnet-probes.json) do not
establish transaction qualification. No Oath Wallet integration was performed.

## BNB testnet fixture preparation

The [fixed BSC testnet lab](../labs/bnb/README.md) now uses the restricted EVM
adapter with immutable chain/genesis/endpoint, a pre-existing public test sink,
one-wei value and a fixed legacy fee ceiling. Seven targeted host tests cover
network mismatch, snapshots, exact receipts, balance effects, finality/reorg
contradictions and single-attempt signing. Internal AI review found no actionable
issues. No funded BNB transfer has completed; this is fixture preparation only.

A clean-source cancellation check stopped the unfunded BNB process before any
approval, signature or submission, and verified removal of its temporary public
funding directory. See [cancellation evidence](../evidence/bnb-testnet-cancellation.json).
Network identity, fee and pre-existing recipient probes passed. The free funding
sources checked were restricted or unavailable; see the dated
[availability record](../evidence/bnb-testnet-funding-availability.json).
