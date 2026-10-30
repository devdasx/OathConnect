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
