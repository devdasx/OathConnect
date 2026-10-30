# OathConnect v1 draft

This specification is under implementation and review, not a stable production standard.

## Pairing and encryption

The website creates a random 256-bit session ID, a random 256-bit pairing secret and an ephemeral P-256 ECDH key. A local QR/deep-link conveys these, the website public key, relay origin and a five-minute deadline. Wallets must explicitly trust the relay origin before making any connection; never silently trust a URL in a scanned QR.

The wallet generates its own ephemeral P-256 ECDH key. A HMAC-SHA256 keyed by the pairing secret authenticates the complete transcript, including both public keys, session, deadline and relay origin. Both sides derive independent directional AES-256-GCM keys using ECDH, HKDF-SHA256, the pairing secret as salt, and the transcript as domain-separated context. The website verifies the wallet transcript before accepting it. Each endpoint permits one peer per session.

Each encrypted frame authenticates protocol version, session, sender role, strictly increasing sequence and expiry as associated data. Random 96-bit GCM nonces and separate directional keys prevent reflection. Session state is intentionally ephemeral: after process restart or ambiguous delivery failure, close and re-pair instead of resetting counters or silently retrying a spending request. Session TTL is at most one hour. No resumption or early data in v1.

## Hosted admission

Public, version-controlled registry entries approve integrator Ed25519 issuer public keys, roles and exact HTTPS website origins. The integrator backend issues a grant valid for at most five minutes, binding project, issuer key ID, client Ed25519 proof key, session, role and exact relay audience. Every relay operation carries a fresh signed proof covering the grant digest, method, path, body digest, timestamp and random nonce. The relay atomically checks and consumes nonces before modifying a mailbox. A copied token alone is insufficient. Native-app authenticity is the integrator issuer's responsibility; client IDs and Origin headers are not authentication.

## Transport and authorization

The reference relay uses bounded HTTPS mailboxes with explicit cursor reads, acknowledgments, quotas, expiry and close. It stores only handshake public material and encrypted frames. Admission does not authorize signing. Negotiated chain/account/method grants are end-to-end encrypted and enforced locally. Requests bind an exact account and chain, have unique IDs and short deadlines, and require a fresh approval decision over the exact immutable request digest. Error messages are bounded and must not leak payloads or signing secrets.

Unknown versions, unexpected fields, unsupported methods, missing permissions, duplicate IDs, invalid network IDs and expired messages are rejected. Websites are responsible for adding OathConnect support; this is not a WalletConnect compatibility bridge.
