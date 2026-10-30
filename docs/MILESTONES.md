# Milestones

Every release is a prerelease until the readiness gates are satisfied.

1. Public foundation: scope, license, threat model and release gates.
2. Protocol: bounded schemas, authenticated pairing, encrypted frames, conformance tests.
3. Relay: approved admission, proof of possession, isolated mailboxes, quotas/expiry/revocation, Cloudflare runtime tests.
4. SDKs: website/wallet session lifecycle, permissions, native interoperability and integration examples.
5. Delivery: CI, GitHub-controlled deployment, public version provenance and adversarial testing.
6. Network qualification: per-chain real testnet evidence and THORChain example; independent audit and production decision.

Unfinished milestones must not be labeled complete to justify a version tag.

## Published previews

- `v0.0.1-foundation`: public scope, threat model, license and release gates.
- `v0.1.0-alpha.1`: TypeScript encrypted pairing, SDK authorization and Cloudflare relay foundation.
- `v0.2.0-alpha.1`: signed peer identity, wallet-selected accounts, global allocation limits, Swift interoperability/authorization, THORChain read-only quote example, XRP testnet receipt and GitHub deployment pipeline. Native session negotiation and signed identity verification were added in the following public commit; the production/network gates are still open.
- `v0.2.0-alpha.2`: closes a signing race during session shutdown, retains request replay protection across authorizer replacement, and aligns request IDs and UTF-8 byte limits across SDKs. Internal targeted regression review passed 25 TypeScript and 12 Swift host tests; independent audit remains open.
- `v0.2.0-alpha.3`: bounds approval by session expiry and honors native task cancellation before execution. Includes Stellar testnet evidence and the earlier attempt history. Internal targeted regression review passed 26 TypeScript and 14 Swift host tests; independent audit remains open.
- `v0.2.0-alpha.4`: checks both integrators' current approval and pinned issuer on every relay operation, closes sessions on observed revocation, and drops their queued ciphertext. Includes the Sui local testnet receipt. Passed 28 TypeScript and 14 Swift host tests; independent audit remains open.
- `v0.2.0-alpha.5`: real Chrome-to-Swift macOS interoperability through Cloudflare, same-origin browser polling support without relaxing signed admission, and live Stellar/Sui testnet receipts. Qualification fixtures and filtered evidence are public. Passed 30 TypeScript tests, 14 native SDK host tests, one native fixture host test and three JavaScript evidence/file tests. No Oath Wallet integration, iOS runtime test, independent audit or production certification.
- `v0.3.0-alpha.1`: restricted EVM transaction validation, exact-byte signature verification and cooperative execution contexts in both SDKs, including cancellation propagation into detached native tasks. Passed 46 TypeScript tests, 16 native SDK host tests, one native fixture host test, three JavaScript fixture tests and generic iOS compilation. Four exact CI package archives, checksums and release evidence are published. GitHub deployed verified commit `8a568d076f43b89f409aec0eca9b8edfe626772a`; Sepolia and production qualification remain open.

## Published 0.3.0-alpha.2

Safe HTTP status reporting and response-body cancellation are implemented. A
funded Sepolia attempt isolated an HTTP failure at submission; delivery remains
uncertain, with no resubmission. Fresh fixture runs explicitly use PublicNode
for their single submission, while Tenderly supplies archive-pinned state reads.
One fresh native transfer completed through the local relay in Sepolia block
12028472, with the expected receipt/log/balance change and cross-provider checks.
Deployed relay EVM testing, token qualification and general transaction coverage
remain open. A local abuse regression also reproduced and fixed global request
accounting for capacity-rejected relay allocations. All 48 TypeScript tests pass.
The native sources are unchanged from the published preview. Other networks
and independent review remain open.
The release retains development-preview status. Its four exact CI archives, checksums and verification evidence are published at the GitHub release. The tagged source and deployment are `e090d7d0f83e9bd4e954f782eecbbf339ae5e0b2`.

## Deployed Sepolia qualification

A separate fresh account completed the same restricted native transfer through
the deployed relay at `8c06a27cf1167993428b0728237260ac53aab0fc`, in Sepolia
block 12028584, with one approval/signature/submission and the expected receipt,
log and balance delta. See [live receipt](../evidence/evm-sepolia-live.json).
The disposable registry approval is disabled in source after this test.
The read-only reconciliation command and five adversarial tests make the
provider receipt/canonical-block/finalized-height checks reproducible. They do
not verify consensus independently. Token calls, other EVM networks, THORChain
swaps, external audit and production qualification remain open.

## Local Solana qualification

A free faucet funded the disposable devnet account, and clean commit
`14d61fc6cbb278509adf278e5d49fe78b699e354` completed one fixed 0.001 SOL
transfer through the local relay in slot 516914340. Its exact transaction,
signature and receipt effects passed validation. The read-only reconciliation
command checks finalized receipt/status consistency without sending again.
All 18 Solana fixture host tests pass, including four finality reconciliation
tests. The deployed test, token/program transactions, other chains and
independent audit remain open. This milestone does not integrate Oath Wallet.
