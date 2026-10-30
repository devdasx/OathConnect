# Native Swift preview

The independent Swift package uses Apple's CryptoKit, with no external package dependencies. It supports wallet-side authenticated P-256 pairing, HKDF-SHA256 directional keys, AES-GCM frames, Ed25519 admission proof keys and a bounded HTTPS relay transport with redirects disabled. The actor-isolated channel serializes counters, rejects replays and tampering, and cannot resume after restart.

Host tests verify shared public TypeScript-generated fixtures for the pairing MAC and ciphertext in both directions. The fixture private scalars are deliberately public connection-test inputs, not wallet keys and never suitable for live pairing. No Oath Wallet integration, simulator or physical-device test is performed by this package.

The Swift package exposes transport/cryptography primitives and an actor-isolated authorization gate that binds a local approval to the exact canonical request digest. WalletSession provides signed peer verification, wallet-selected capability negotiation, explicit approval callbacks, one-request execution and shutdown. The wallet application must supply its own trusted project registry, short-lived grant callback, chain transaction decoders and approval UI. Transport injection is available for host testing. This native package is therefore not a drop-in production wallet SDK.

WalletSession passes its expiry into the authorizer; standalone callers supply `sessionExpires` themselves. Authorization checks task cancellation before review and again after review and approval. Signing adapters must also check cancellation and wallet lock state immediately before using a key. Cancellation cannot retract a signature or transaction already produced or broadcast.

Run `swift test`. On filesystems that generate AppleDouble sidecars, use a local APFS scratch directory, for example `swift test --scratch-path /tmp/oathconnect-swift-build`, to avoid code-signing resource-sidecar errors. This is a host test, not an iOS runtime test.
