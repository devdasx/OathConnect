# OathConnect

An independent, open-source connection protocol for websites and wallets. No WalletConnect dependency, shared relay, or wire compatibility. Websites must deliberately integrate OathConnect.

**Development preview — NOT approved for real funds or production wallet integration.** No external security audit has been completed. Passing tests cannot establish absence of security defects.

## Scope

- Browser/Node TypeScript protocol and SDK packages; native Swift interoperability package.
- End-to-end encrypted, short-lived sessions; wallet-controlled chain/account/method permissions; explicit per-request authorization.
- Cloudflare Workers relay with Durable Objects; approved integrator admission, bounded encrypted mailboxes, revocation and expiry.
- Public source, protocol, threat model, approval registry, build workflows, release tags, and test evidence.
- THORChain integration example and a separately recorded chain/testnet validation matrix.

Oath Wallet source and integration are outside this repository. Oath Wallet integration requires a later explicit instruction.

## Trust boundaries

The relay cannot sign blockchain transactions and does not receive recovery phrases, wallet private keys or plaintext requests. Integrator admission is not transaction approval or an endorsement. A wallet must decode the actual transaction, verify its network/account, display effects and fees, and obtain user approval locally. Unknown transaction formats must be rejected.

The hosted service requires approval of wallet and website integrators. The public protocol and MIT-licensed software can be independently audited, modified and self-hosted without Oath's approval. The hosted approval policy is separate from the software license.

See [protocol](docs/PROTOCOL.md), [security](SECURITY.md), [release gates](docs/READINESS.md), and [milestones](docs/MILESTONES.md).
