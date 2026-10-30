# TypeScript integration preview

Build with `npm run build`. Workspace packages export ESM and TypeScript source types. Published prerelease artifacts are development previews, not npm production packages.

## Pairing

Website: call `createIdentity()` for the admission proof key and `createPairing(trustedRelay)`. Obtain a short-lived grant from your approved backend bound to the invitation session, local proof public key, role and exact origin. Construct `RelayClient` (browser origin is read automatically; Node website clients must supply their exact `origin`), call `create(invitation.expires)`, and render `pairing.uri` as a local QR. Never send that URI to third-party rendering or analytics services.

Wallet: require an explicitly trusted relay, call `joinPairing(uri, trustedRelay)`, obtain its wallet grant with a fresh proof identity, construct `RelayClient`, and call `join(hello)`. The website polls `hello()` and authenticates it with `pairing.accept(hello)`.

Construct `Session(channel, relayClient, trustedProjects)` on both ends. Website calls `propose(requestedCapabilities)` and the wallet calls `approveSession(localDecision)`. A proposal specifies CAIP-2 chains and methods, and optionally exact requested accounts. The wallet selects accounts locally and shares only those the user approves. Only the exact approved chain/account/method subset is usable; no account wildcard survives negotiation.

## Signing requests

The website calls `request(capability, method, params)`. The wallet registers `WalletAdapter`s by exact `chain/method`, constructs a `WalletAuthorizer` using the negotiated capabilities and its local approval UI, then calls `serveOnce(authorizer)`.

An adapter must decode the actual transaction and validate the network, sender, recipients, amounts, fees and all contract/approval effects. It returns a review bound to `digest(canonical(request))`. The local user decision must return the same digest. Only then can `execute()` access the wallet's own signing engine. Unknown formats are rejected. No signing engine, private key import or seed handling is provided by the connection SDK. The separate [`@oathconnect/evm` preview](../packages/evm/README.md) supplies a restricted reusable EVM decoder and signing boundary; it still requires wallet-owned keys, policy and approval UI.

The test adapter demonstrates transport and approval control flow only. It does not prove blockchain signing correctness. Integrators must implement and audit chain adapters; a chain listed in the compatibility inventory is not an audited adapter.

## Lifecycle

Only one operation may run per endpoint at a time. Sessions expire after at most an hour, requests after two minutes, grants after five minutes. Refresh grants through the integrator backend without changing the proof key. Call `close()` on lock, logout, account/network changes or disconnect; revoke the local authorizer too. Endpoints do not persist encryption keys/counters. On process restart, timeout or ambiguous delivery, re-pair. Never automatically retry a request that might already have signed or broadcast.

`serveOnce` bounds authorization by both the request and session expiry, including while a review or approval is pending. Standalone authorizer users must supply their owning session deadline as the third `handle` argument. `review(request, context)`, `approve(request, review, context)` and `execute(request, context)` now receive an `ExecutionContext`. Call `context.assertActive()` after asynchronous waits and immediately before accessing keys or broadcasting, and pass its abort signal to network calls. The context expires with the request/session, aborts on authorizer closure, and becomes invalid when `handle` ends. Wallet locking remains the signer's responsibility. Cancellation cannot undo a signature or a submission already dispatched. Report uncertain broadcast outcomes without automatically retrying.

The minimal SDK polls every two seconds with bounded mailboxes. Push notifications, background wakeup and session resumption are not implemented.

## Verified peer identity

Both peers sign their encrypted negotiation messages with their per-session admission proof keys. Verify the issuer against a separately trusted registry before displaying a verified integrator identity. Never auto-trust keys fetched solely from the relay being authenticated. Applications must update/revoke their pinned registries through an authenticated distribution channel. Project names come from that registry; exact website origins come from signed grants. Admission approval is not a promise that the website is safe.

## Installing preview archives

Download the needed `.tgz` files from the same GitHub prerelease (four packages starting with the 0.3 preview) and verify their SHA-256 checksums. Install the protocol and SDK archives together (`npm install ./oathconnect-protocol-<version>.tgz ./oathconnect-sdk-<version>.tgz`); include the THORChain archive for its read-only example and the EVM archive for its restricted signing adapter. These previews are supplied as GitHub release artifacts, not claimed to be published in the npm registry. Swift clients add this repository as a Swift package pinned to a release tag or exact commit.
