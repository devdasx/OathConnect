# Hosted integrator admission

No public integrators are approved yet. An empty registry intentionally denies all session operations.

Request approval by opening an issue with the integrator name, public website, requested wallet/dapp roles, exact HTTPS origins, issuer Ed25519 public key and key identifier, security contact, source/audit links and supported chains/methods. Do not submit secrets. Approval requires a maintainer-reviewed registry change. Disabled entries or removed keys revoke subsequent relay access immediately after deployment, including existing sessions.

An approved integrator must run its own authenticated grant issuer. It must authorize the real user/app before granting a client key access; a public endpoint that blindly signs arbitrary requests defeats admission. Browser Origin checks supplement authentication; they do not identify native apps or prevent malicious non-browser clients.

Private issuer keys must never be bundled in apps. The library provides signing primitives, not a ready-to-use unauthenticated issuer service. Admission is not a security endorsement and does not grant transaction approval. Self-hosted operators maintain their own registry.
