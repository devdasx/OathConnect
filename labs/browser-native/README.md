# Browser/native live qualification

This fixture pairs real browser WebCrypto with the standalone Swift macOS host's
CryptoKit and URLSession through the deployed preview relay. It automatically
approves **only** the fixed `oath:test / oath_echo` request and account
`interop-fixture`. It has no blockchain keys, signing adapter, wallet integration,
mainnet spending, or general approval UI. Do not reuse its automatic approval in
a wallet. A passing result does not certify iOS, other browsers, or production.

The browser uses the public registry bundled at build time; the native client uses
the same checked-out registry. Neither trusts a registry obtained only from the
relay. The operator controller checks the deployed commit and registry first.
The issuer's private key stays outside Git and both clients. Public proof-key
certificates are delivered through local files and expire within five minutes.
No additional local or public authorization server is opened.

## Operator procedure

1. Build with `npm run check` and
   `swift build --package-path labs/browser-native/native --scratch-path /tmp/oathconnect-browser-native-build`.
2. Prepare the disposable issuer using `scripts/prepare-validation.mjs`. Include
   `https://oathconnect-preview.thuglifex.workers.dev` in that project's origins,
   keeping the one-hour deadline. Review/publish that public approval through a
   protected GitHub PR and let verification/deployment finish. Use the exact
   deployed main commit locally. No key belongs in the repository or browser.
3. Open the deployed `/interop/` page. Download its pairing file, which contains a
   five-minute secret; keep it local. Run
   `node labs/browser-native/controller.mjs prepare /absolute/path/to/bootstrap.json`.
4. In the browser load `browser-grant.json` from the newly printed private directory
   and click Start connection. When waiting, run
   `node labs/browser-native/controller.mjs run /tmp/oathconnect-browser-native-XXXXXX /tmp/oathconnect-browser-native-build/debug/InteropHost`.
5. After the page reports PASS, download its result and run
   `node labs/browser-native/controller.mjs finish /tmp/oathconnect-browser-native-XXXXXX /absolute/path/to/browser-result.json`.
   The controller checks both results and writes sanitized evidence, then lets the
   native host close. The native host also closes after a bounded wait if abandoned.
6. Disable the validation project through GitHub, verify its deployed disabled
   state, and remove the task-owned private files, pairing download and issuer key.
   Publish the evidence with its tested commit and exact platform limits.

All generated credentials and pairing files are ephemeral. Never publish them,
copy their contents to terminal logs, or leave an approved validation project on.
The public fixture route serves no grants; an unapproved visitor cannot join the
relay. CSP limits scripts/styles/connections to the fixture's own origin and
disables framing, referrers and caching. API requests retain signed admission and
proof-of-possession requirements.
