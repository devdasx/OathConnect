# Security policy

No version is currently approved for production or real funds. Do not interpret a published release or reachable relay as a security certification.

Report vulnerabilities privately using GitHub's private vulnerability reporting for this repository. Never include private keys, seed phrases, tokens or user payloads in a public issue. If private reporting is unavailable, do not disclose exploitation details publicly; contact the repository owner through GitHub first.

## Required invariants

1. Wallet signing secrets never enter the protocol, relay, examples, logs or telemetry.
2. The wallet independently validates every chain/account/method and transaction. Session approval never implies spending approval.
3. Authenticated encryption binds role, protocol version, session and sequence. Altered, expired, replayed or reflected frames fail closed.
4. A QR pairing secret is a bearer secret. It is generated randomly, expires quickly, is never sent to the relay and must not be logged, stored in analytics or loaded by third-party QR services.
5. Admission is cryptographically bound to a short-lived client key, session, role and deployment audience. Approved project issuer private keys stay in integrator backends, never distributed in wallet apps or web bundles.
6. All allocations, messages, queues, lifetimes, authentication windows and request rates have limits. Closing a session prevents subsequent work.
7. Source review, automated tests, network probes, real testnet transactions, independent audits and mainnet readiness are distinct evidence categories.

## Threat model

Attackers may control a website, network, relay operator or another approved integrator, steal an admission token, race requests, replay traffic, inject malformed payloads or exhaust resources. TLS is required, but the relay is not trusted with plaintext or transaction approval. QR interception, compromised wallet/browser/OS, malicious signing adapters, dishonest transaction displays, dependency compromise, compromised integrator issuer keys and colluding administrators remain material risks. A compromised relay may censor or correlate metadata. It must not be able to decrypt paired traffic by itself.

No custom cryptographic primitives are permitted. Protocol composition still requires independent specialist review. Public source does not replace an audit.
