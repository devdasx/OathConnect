import {build} from 'esbuild';
import {existsSync, readFileSync, mkdirSync, copyFileSync, writeFileSync} from 'node:fs';
for (const name of ['protocol', 'sdk', 'thorchain', 'evm']) {
  const entry = `packages/${name}/src/index.ts`;
  if (existsSync(entry)) await build({entryPoints: [entry], outfile: `packages/${name}/dist/index.js`, bundle: true, format: 'esm', platform: 'neutral', target: 'es2023', packages: 'external', sourcemap: true});
}
const {validateProjects} = await import('../packages/protocol/dist/index.js');
validateProjects(JSON.parse(readFileSync('registry/projects.json','utf8')));
mkdirSync('dist/static/interop',{recursive:true});
writeFileSync('dist/static/.assetsignore','._*\n**/._*\n.DS_Store\n**/.DS_Store\n');
await build({entryPoints:['labs/browser-native/browser.ts'],outfile:'dist/static/interop/browser.js',bundle:true,format:'esm',platform:'browser',target:'es2023'});
for(const name of ['index.html','style.css'])copyFileSync('labs/browser-native/'+name,'dist/static/interop/'+name);
if (existsSync('relay/src/worker.ts')) await build({entryPoints: ['relay/src/worker.ts'], outfile: 'dist/worker.js', bundle: true, format: 'esm', platform: 'browser', target: 'es2023', external: ['cloudflare:workers']});
