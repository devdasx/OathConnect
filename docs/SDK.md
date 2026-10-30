# TypeScript integration preview

Build with `npm run build`. Workspace packages export ESM and TypeScript source types. Published prerelease artifacts are development previews, not npm production packages.

## Pairing

Website: call `createIdentity()` for the admission proof key and `createPairing(trustedRelay)`. Obtain a short-lived grant from your approved backend bound to the invitation session, local proof public key, role and exact origin. Construct `RelayClient`, call `create(invitation.expires)`, and render `pairing.uri` as a local QR. Never send that URI to third-party rendering or analytics services.

Wallet: require an explicitly trusted relay, call `joinPairing(uri, trustedRelay)`, obtain its wallet grant with a fresh proof identity, construct `RelayClient`, and call `join(hello)`. The website polls `hello()` and authenticates it with `pairing.accept(hello)`.

Construct `Session(channel, relayClient)` on both ends. Website calls `propose(capabilities)` and the wallet calls `approveSession(localDecision)`. Only the exact approved subset is usable. Each entry specifies a CAIP-2 chain, an exact address and method list. This draft expects the website to know the desired account; privacy-preserving wallet-selected account discovery is not implemented yet.

## Signing requests

The website calls `request(capability, method, params)`. The wallet registers `WalletAdapter`s by exact `chain/method`, constructs a `WalletAuthorizer` using the negotiated capabilities and its local approval UI, then calls `serveOnce(authorizer)`.

An adapter must decode the actual transaction and validate the network, sender, recipients, amounts, fees and all contract/approval effects. It returns a review bound to `digest(canonical(request))`. The local user decision must return the same digest. Only then can `execute()` access the wallet's own signing engine. Unknown formats are rejected. No signing engine, private key import or seed handling is provided by the connection SDK.

The test adapter demonstrates transport and approval control flow only. It does not prove blockchain signing correctness. Integrators must implement and audit chain adapters; a chain listed in the compatibility inventory is not an audited adapter.

## Lifecycle

Only one operation may run per endpoint at a time. Sessions expire after at most an hour, requests after two minutes, grants after five minutes. Refresh grants through the integrator backend without changing the proof key. Call `close()` on lock, logout, account/network changes or disconnect; revoke the local authorizer too. Endpoints do not persist encryption keys/counters. On process restart, timeout or ambiguous delivery, re-pair. Never automatically retry a request that might already have signed or broadcast.

The minimal SDK polls every two seconds with bounded mailboxes. Push notifications, background wakeup, session resumption and account discovery are deliberately not advertised as completed features.
