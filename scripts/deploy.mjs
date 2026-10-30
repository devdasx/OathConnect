import {execFileSync} from 'node:child_process';
const sha = execFileSync('git', ['rev-parse','HEAD'], {encoding:'utf8'}).trim();
const latest = execFileSync('git', ['ls-remote', 'https://github.com/devdasx/OathConnect.git', 'refs/heads/main'], {encoding:'utf8'}).split(/\s/)[0];
if (sha !== latest) {console.log('Superseded commit: deployment skipped'); process.exit(0);}
if (!/^[a-f0-9]{40}$/.test(sha) || !process.env.CLOUDFLARE_ACCOUNT_ID || !process.env.CLOUDFLARE_API_TOKEN) throw Error('Deployment requires a checked-out commit and scoped Cloudflare credentials');
execFileSync('node', ['node_modules/wrangler/bin/wrangler.js','deploy','--var',`RELEASE_SHA:${sha}`], {stdio:'inherit'});
// Worker routing can take a short time to propagate after the first upload.
// Retry only this read-only health probe; never replay a wallet request.
let verified = false;
for (let attempt = 0; attempt < 12; attempt++) {
  try {
    const response = await fetch('https://oathconnect-preview.thuglifex.workers.dev/health', {signal: AbortSignal.timeout(5000), cache:'no-store', redirect:'error'});
    if (response.ok && response.headers.get('content-type')?.startsWith('application/json')) {
      const health = await response.json();
      if (health.commit === sha && health.productionReady === false && health.service === 'OathConnect') {verified = true; break;}
    }
  } catch { /* bounded propagation/network retries; no response bodies logged */ }
  await new Promise(resolve => setTimeout(resolve, 5000));
}
if (!verified) throw Error('Deployed commit verification failed after propagation window');
console.log(`Verified preview commit ${sha}`);
