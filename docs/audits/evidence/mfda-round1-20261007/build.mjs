import {mkdtemp,readdir,readFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../../..');
for(const k of Object.keys(process.env))if(/^(SUPABASE|VITE_|RENTCAST|DATABASE_URL)/.test(k))delete process.env[k];
process.env.VITE_SUPABASE_URL='https://mfda-security.invalid';
process.env.VITE_SUPABASE_ANON_KEY='SYNTHETIC';
process.env.SUPABASE_SERVICE_ROLE_KEY='SYNTHETIC-BUILD-SERVICE-SECRET';
process.env.RENTCAST_API_KEY='SYNTHETIC-BUILD-RENTCAST-SECRET';
const outDir=await mkdtemp('/private/tmp/mfda-round1-build-');
const {build}=await import(path.join(repo,'mfda/node_modules/vite/dist/node/index.js'));
await build({root:path.join(repo,'mfda'),configFile:path.join(repo,'mfda/vite.config.js'),envDir:false,build:{outDir}});
let count=0;
async function scan(dir){for(const entry of await readdir(dir,{withFileTypes:true})){
  const p=path.join(dir,entry.name);if(entry.isDirectory())await scan(p);
  else if(/\.(js|html|css|map)$/.test(entry.name)){count++;const s=await readFile(p,'utf8');
    if(/SYNTHETIC-BUILD-(SERVICE|RENTCAST)-SECRET|SUPABASE_SERVICE_ROLE_KEY|X-Api-Key|api\.rentcast\.io/.test(s))throw new Error('Server secret reference in frontend build');
  }
}}
await scan(outDir);console.log('BUILD PASS; server-secret canary scan PASS;',count,'assets;',outDir);
