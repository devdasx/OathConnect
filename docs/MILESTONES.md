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
