# THORChain example

`@oathconnect/thorchain` provides bounded read-only chain discovery and a deliberately narrow direct-swap quote reviewer. It checks both chain halt states, current vault address, quote expiry, destination, asset and nonzero slippage protection. Unsupported memo extensions, affiliate fees and custom refunds are rejected. It never stores an inbound address for later reuse.

Connect a website and wallet using the SDK workflow in `docs/SDK.md`. Use wallet-selected account discovery. An integrator then supplies its chain-specific transaction builder and wallet decoder. The wallet must independently verify the exact transaction bytes against a fresh trusted THORNode response and user-visible swap details before signing; a website's `QuoteReview` object is not trusted authorization. Amount units in the quote API are 1e8, while on-chain amounts use each chain's native units. Do not compare native units with quote amounts without conversion. The helper returns the published dust threshold without comparing incompatible units; the wallet must enforce native chain dust rules.

This is not a working mainnet swap application, an endorsement by THORChain, or a completed all-chain signing implementation. No THORChain site has been modified to accept OathConnect. The separate XRP lab exercises a real testnet payment through OathConnect, not a THORChain swap. See `evidence/` for actual results.

Primary references: https://dev.thorchain.org/concepts/connecting-to-thorchain.html, https://dev.thorchain.org/swap-guide/quickstart-guide.html, https://dev.thorchain.org/concepts/querying-thorchain.html.
