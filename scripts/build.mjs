import {build} from 'esbuild';
import {existsSync, readFileSync} from 'node:fs';
for (const name of ['protocol', 'sdk', 'thorchain']) {
  const entry = `packages/${name}/src/index.ts`;
  if (existsSync(entry)) await build({entryPoints: [entry], outfile: `packages/${name}/dist/index.js`, bundle: true, format: 'esm', platform: 'neutral', target: 'es2023', packages: 'external', sourcemap: true});
}
const {validateProjects} = await import('../packages/protocol/dist/index.js');
validateProjects(JSON.parse(readFileSync('registry/projects.json','utf8')));
if (existsSync('relay/src/worker.ts')) await build({entryPoints: ['relay/src/worker.ts'], outfile: 'dist/worker.js', bundle: true, format: 'esm', platform: 'browser', target: 'es2023', external: ['cloudflare:workers']});
