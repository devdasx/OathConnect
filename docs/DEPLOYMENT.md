# GitHub-controlled preview deployment

The checked-in deployment workflow deploys only a successful `Verify` run triggered by a push to this repository's `main` branch. Pull requests, forks and failed tests cannot deploy. It checks out that exact verified commit, publishes its SHA at `/health`, and checks that the live endpoint returns the same SHA. Actions and npm dependencies are pinned. No Cloudflare credentials are checked in.

Configure the GitHub `preview` environment with `CLOUDFLARE_ACCOUNT_ID` and a dedicated `CLOUDFLARE_API_TOKEN`, restricted to the target account and OathConnect Worker where supported. Then enable repository variable `CLOUDFLARE_DEPLOY_ENABLED=true`. Never copy a broad interactive OAuth token into CI. With no deployment credentials, the deploy job remains explicitly skipped; that is not a successful deployment.

The registry denies session traffic unless an integrator has an enabled approval. The disposable validation identity is retained as a disabled public record. `/health` and `/v1/registry` are public. Request logging is disabled. Cloudflare may retain platform metadata under its own policy; the operator cannot truthfully claim zero provider metadata collection.

## Rollback and revocation

Revert a problematic commit through GitHub, pass CI, and deploy the revert. For urgent admission revocation, disable a project or remove a compromised issuer key in the public registry and deploy. Every request validates the active registry. Clients also maintain authenticated registry snapshots and must distribute urgent revocations through their own trusted channel. Close and re-pair sessions after an incident; do not restore stale counters or keys. Encryption secrets are not stored by the relay.

The relay enforces per-IP and per-project limits before creating Durable Objects, a globally coordinated 600 requests/minute and 100 new sessions/hour/project allocation budget, plus strict per-session counters, 32 frames per direction, 24 KiB plaintext per frame, one-hour TTL and alarm-based deletion. The first unauthenticated request is still a billable platform invocation. Production needs account-level abuse protection and measured load/cost limits; application limits alone do not guarantee an infrastructure cost cap.

The initial deployment credential is limited to `oathconnect-preview`, with the Individual Workers Editor role and a 90-day lifetime ending 2027-01-28. It is stored only as a GitHub `preview` environment secret. The environment accepts deployments from `main` only. Rotate before expiry; do not broaden account access to bypass deployment errors.
