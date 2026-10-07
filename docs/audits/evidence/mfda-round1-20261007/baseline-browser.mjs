// Extract immutable starting-SHA UI into a disposable directory. External
// browser traffic is blocked by the inherited accepted P0 harness.
import {execFile,spawn} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp,mkdir,writeFile,symlink} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const exec=promisify(execFile),evidence=path.dirname(fileURLToPath(import.meta.url)),repo=path.resolve(evidence,'../../../..');
const sha='ae5426a39e5a689a8eece17ae8f096edfd8924be';
const dir=await mkdtemp('/private/tmp/mfda-round1-starting-');
const {stdout}=await exec('git',['ls-tree','-r','--name-only',sha,'mfda','packages/mf-calc'],{cwd:repo});
for(const f of stdout.trim().split('\n')){
  await mkdir(path.dirname(path.join(dir,f)),{recursive:true});
  const {stdout:content}=await exec('git',['show',`${sha}:${f}`],{cwd:repo,maxBuffer:4*1024*1024});
  await writeFile(path.join(dir,f),content);
}
await symlink(path.join(repo,'mfda/node_modules'),path.join(dir,'mfda/node_modules'));
const env=Object.fromEntries(Object.entries(process.env).filter(([k])=>! /^(PG|SUPABASE|VITE_|DATABASE_URL|RENTCAST)/.test(k)));
env.MFDA_R1_BASELINE_APP=path.join(dir,'mfda');
const c=spawn(process.execPath,['--test','financial/browser.test.mjs'],{cwd:path.join(repo,'mfda'),env});let out='';
c.stdout.on('data',b=>out+=b);c.stderr.on('data',b=>out+=b);
const code=await new Promise((r,j)=>{c.on('error',j);c.on('close',r);});
await writeFile(path.join(evidence,'pre-fix-browser.txt'),`Starting SHA: ${sha}\nExtracted: ${dir}\n${out}`);
console.log('immutable baseline browser exit',code,out.split('\n').filter(s=>/loaded mix|# (tests|pass|fail|skipped)/.test(s)).join('\n'));
