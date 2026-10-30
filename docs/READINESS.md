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
- Swift pairing/ciphertext interoperability and digest-bound authorization pass host tests; the package compiles for generic iOS. Native high-level session negotiation and signed peer verification have host regression tests; a real browser-to-native runtime exercise remains open. No simulator or device checks were run.
- One disposable-account XRP Ledger Testnet payment was confirmed in ledger 21939918 through a local OathConnect session. See [receipt](../evidence/xrpl-testnet.json). A second payment succeeded through the deployed relay in ledger 21940233; see [live receipt](../evidence/xrpl-testnet-live.json). Neither payment is a THORChain swap. An earlier harness attempt rejected undefined optional fields before signing; the harness now explicitly normalizes the prepared transaction and reviews that exact snapshot.
- Read-only discovery observed 13 external THORChain chains. GAIA and SOL were halted at observation; GAIA and ZEC are absent from the current Oath catalog. The app catalog contains 42 chains. See the dated files in [evidence](../evidence).
- Solana devnet network identity was verified, but the official free-funding request returned HTTP 410 before any signing; see [attempt](../evidence/solana-devnet.json). Other real chain transactions and every THORChain swap remain unverified. Generic chain identifiers do not establish adapter coverage.
- GitHub verification and deployment succeeded. A one-hour disposable validation identity was used for the live XRP test and then disabled through GitHub. No third-party integrator is approved. Independent audit, load/abuse qualification and production approval remain open.
