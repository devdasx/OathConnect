# Native Swift preview

The independent Swift package uses Apple's CryptoKit, with no external package dependencies. It supports wallet-side authenticated P-256 pairing, HKDF-SHA256 directional keys, AES-GCM frames, Ed25519 admission proof keys and a bounded HTTPS relay transport with redirects disabled. The actor-isolated channel serializes counters, rejects replays and tampering, and cannot resume after restart.

Host tests verify shared public TypeScript-generated fixtures for the pairing MAC and ciphertext in both directions. The fixture private scalars are deliberately public connection-test inputs, not wallet keys and never suitable for live pairing. No Oath Wallet integration, simulator or physical-device test is performed by this package.

The Swift package exposes transport/cryptography primitives and an actor-isolated authorization gate that binds a local approval to the exact canonical request digest. Native session negotiation, signed peer identity presentation, account selection, transaction decoders and approval UI must still be integrated and audited before use. The full negotiation/authorization reference implementation is currently TypeScript. This native package is therefore not a drop-in production wallet SDK.

Run `swift test`. On filesystems that generate AppleDouble sidecars, use a local APFS scratch directory, for example `swift test --scratch-path /tmp/oathconnect-swift-build`, to avoid code-signing resource-sidecar errors. This is a host test, not an iOS runtime test.
