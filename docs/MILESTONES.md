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
- `v0.2.0-alpha.1`: signed peer identity, wallet-selected accounts, global allocation limits, Swift interoperability/authorization, THORChain read-only quote example, XRP testnet receipt and GitHub deployment pipeline. Native session completion and the production/network gates are still open.
