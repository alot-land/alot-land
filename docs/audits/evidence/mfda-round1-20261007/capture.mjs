// Generates local test evidence. Does not load dotenv or connect to any provider.
import { spawn } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const evidence=path.dirname(fileURLToPath(import.meta.url));
const repo=path.resolve(evidence,'../../../..');
const env=Object.fromEntries(Object.entries(process.env).filter(([k])=>! /^(PG|SUPABASE|VITE_|DATABASE_URL|RENTCAST)/.test(k)));
const phase=process.argv[2] || 'pre-fix';
const jobs=phase==='pre-fix' ? [
  ['regressions','packages/mf-calc','npm',['test','--','test/round1-regressions.test.ts']],
  ['typecheck','packages/mf-calc','npm',['run','typecheck']],
  ['persistence','mfda',process.execPath,['--test','financial/persistence.test.mjs']],
] : [
  ['calc','packages/mf-calc','npm',['test']],
  ['typecheck','packages/mf-calc','npm',['run','typecheck']],
  ['scanner','workers/scan','npm',['test']],
  ['financial','mfda',process.execPath,['--test','--test-concurrency=1','financial/persistence.test.mjs','financial/transaction.test.mjs','financial/browser.test.mjs']],
  ['security','mfda','npm',['run','test:security']],
  ['independent','mfda',process.execPath,['--test','--test-concurrency=1',path.join(evidence,'independent-regression.test.mjs'),path.join(evidence,'csv-pages.test.mjs')]],
  ['build','mfda',process.execPath,[path.join(evidence,'build.mjs')]],
];
// Browser harnesses use a fixed port: run sequentially.
const results={phase,environment:'synthetic; local disposable PostgreSQL; no dotenv/provider connections',checks:{}};
for(const [name,cwd,cmd,args] of jobs){
  const c=spawn(cmd,args,{cwd:path.join(repo,cwd),env});let output='';
  c.stdout.on('data',b=>output+=b);c.stderr.on('data',b=>output+=b);
  const code=await new Promise((r,j)=>{c.on('error',j);c.on('close',r);});
  await writeFile(path.join(evidence,`${phase}-${name}.txt`),output);
  results.checks[name]={code,command:[cmd,...args],cwd:path.join(repo,cwd)};
  console.log(phase,name,'exit',code,output.split('\n').filter(s=>/# (tests|pass|fail|cancelled|skipped)|Test Files|Tests  /.test(s)).join('\n'));
}
await writeFile(path.join(evidence,`${phase}-results.json`),JSON.stringify(results,null,2)+'\n');
if(phase!=='pre-fix')process.exitCode=Object.values(results.checks).some(r=>r.code!==0) ? 1 : 0;
