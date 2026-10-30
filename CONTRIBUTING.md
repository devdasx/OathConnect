# Contributing

Use Node 24 or later. Run `npm ci --ignore-scripts`, `npm run check`, `npm audit --audit-level=low` and `npx wrangler deploy --dry-run` before submitting a change. Dependencies and GitHub Actions are pinned; dependency upgrades require the same checks.

Security-sensitive changes require adversarial regression tests and human review. Do not add secret-bearing logs, automatic signing, broad wildcard permissions, arbitrary URL fetch proxies, silent retries of signing requests, weak randomness, permissive decoding, or admission bypasses. Test registries are injected into local test bundles only; they are not production environment overrides.

Never call a network probe an on-chain transaction test. Store sanitized test evidence, dates and exact validation scope. Do not commit test-wallet private keys, pairing URIs, admission tokens, raw wallet requests or personal account data.

All contributors must preserve Oath Wallet as a separate integration decision. This project must not change the Oath Wallet checkout.
