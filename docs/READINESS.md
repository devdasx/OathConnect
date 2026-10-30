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
- Solana devnet network identity was verified, but the official free-funding request returned HTTP 410 before any signing; see [attempt](../evidence/solana-devnet.json). Chains beyond XRP, Stellar and Sui, and every THORChain swap, remain unverified. Generic chain identifiers do not establish adapter coverage.
- GitHub verification and deployment succeeded. Disposable one-hour validation identities were used for the live tests and are disabled in this registry. No third-party integrator is approved. Independent audit, load/abuse qualification and production approval remain open.

## EVM and execution context preview

The 0.3 preview adds a restricted reusable EVM adapter for native transfers and
wallet-allowlisted ERC-20 transfer/approval calls, with exact-byte signature
verification, network/state checks, bounded fees and single-attempt submission.
It requires wallet-qualified execution-only gas fees; rollups and other fee
models remain unsupported. See [adapter scope and trust limits](../packages/evm/README.md).
Host tests are not evidence of every EVM network or contract's behavior.

TypeScript and Swift adapter/approval callbacks receive a request execution
context that becomes invalid on closure, expiry or completion. Cooperative checks
after asynchronous signing prevent subsequent broadcast. They cannot retract a
submission already dispatched. Wallet lock enforcement and durable reconciliation
of uncertain submissions remain integrator responsibilities.

The current source passed 44 TypeScript tests, 15 native SDK host tests, one
native fixture host test and generic iOS compilation. No simulator or physical
device was used. This is internal validation, not an independent audit.
