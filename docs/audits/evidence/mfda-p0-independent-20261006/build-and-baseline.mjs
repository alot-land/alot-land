import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from 'node:fs';
import { build } from '/Users/davidastone/code/alot-land/alot-land/mfda/node_modules/vite/dist/node/index.js';
import path from 'node:path';
const repo='/Users/davidastone/code/alot-land/alot-land';
const baseline='c800392a3c57cb425dc9ab90ca3cda4893b2e5fd';
const tmp=mkdtempSync('/private/tmp/mfda-reaudit-baseline-');
const files=execFileSync('git',['ls-tree','-r','--name-only',baseline,'packages/mf-calc'],{cwd:repo,encoding:'utf8'}).trim().split('\n');
for(const f of files){const target=path.join(tmp,f);mkdirSync(path.dirname(target),{recursive:true});writeFileSync(target,execFileSync('git',['show',baseline+':'+f],{cwd:repo}));}
symlinkSync(repo+'/packages/mf-calc/node_modules',tmp+'/packages/mf-calc/node_modules');
const result=spawnSync('npm',['run','typecheck'],{cwd:tmp+'/packages/mf-calc',encoding:'utf8'});
writeFileSync('/private/tmp/mfda-reaudit-baseline-typecheck.log',result.stdout+result.stderr);
console.log('Immutable baseline directory:',tmp,'typecheck exit:',result.status);
process.env.VITE_SUPABASE_URL='https://mfda-security.invalid';
process.env.VITE_SUPABASE_ANON_KEY='SYNTHETIC';
await build({root:repo+'/mfda',configFile:repo+'/mfda/vite.config.js',envFile:false,build:{outDir:tmp+'/frontend-build'}});
