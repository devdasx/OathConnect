import {execFileSync} from 'node:child_process';
const sha = execFileSync('git', ['rev-parse','HEAD'], {encoding:'utf8'}).trim();
const latest = execFileSync('git', ['ls-remote', 'https://github.com/devdasx/OathConnect.git', 'refs/heads/main'], {encoding:'utf8'}).split(/\s/)[0];
if (sha !== latest) {console.log('Superseded commit: deployment skipped'); process.exit(0);}
if (!/^[a-f0-9]{40}$/.test(sha) || !process.env.CLOUDFLARE_ACCOUNT_ID || !process.env.CLOUDFLARE_API_TOKEN) throw Error('Deployment requires a checked-out commit and scoped Cloudflare credentials');
execFileSync('node', ['node_modules/wrangler/bin/wrangler.js','deploy','--var',`RELEASE_SHA:${sha}`], {stdio:'inherit'});
const response = await fetch('https://oathconnect-preview.thuglifex.workers.dev/health', {signal: AbortSignal.timeout(15000), cache:'no-store'});
const health = await response.json();
if (!response.ok || health.commit !== sha || health.productionReady !== false) throw Error('Deployed commit verification failed');
console.log(`Verified preview commit ${sha}`);
