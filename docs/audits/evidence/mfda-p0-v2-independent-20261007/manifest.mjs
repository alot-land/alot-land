import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, writeFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const exec=promisify(execFile),root=fileURLToPath(new URL('../../../../',import.meta.url)),dir=fileURLToPath(new URL('./',import.meta.url));
const git=async args=>(await exec('git',args,{cwd:root})).stdout.trim();
const sha=await git(['rev-parse','HEAD']);
if(sha!=='b9288e13f83b2dd5a36718165cf84c8aab1cb6a5')throw new Error('review baseline changed');
if(await git(['diff','--name-only','HEAD']))throw new Error('unexpected tracked modifications');
const files=(await git(['ls-files','mfda/src','mfda/security','mfda/supabase','mfda/netlify/functions','mfda/package.json','mfda/package-lock.json','mfda/vite.config.js','mfda/postcss.config.js','mfda/tailwind.config.js'])).split('\n');
const digest=async f=>createHash('sha256').update(await readFile(f)).digest('hex');
const sourceHashes={};for(const file of files)sourceHashes[file]=await digest(path.join(root,file));
for(const file of ['mfda/node_modules/@react-pdf/renderer/lib/react-pdf.browser.js','mfda/node_modules/queue/index.js','mfda/node_modules/@supabase/supabase-js/src/lib/fetch.ts','mfda/node_modules/@supabase/postgrest-js/src/PostgrestBuilder.ts'])sourceHashes[file]=await digest(path.join(root,file));
const counts=async name=>{
  const log=await readFile(path.join(dir,name),'utf8');const count=k=>Number(log.match(new RegExp('^# '+k+' (\\d+)$','m'))?.[1]);
  return{tests:count('tests'),pass:count('pass'),fail:count('fail'),skipped:count('skipped'),cancelled:count('cancelled')};
};
const evidenceHashes={};for(const file of (await readdir(dir)).sort())if(file!=='manifest.json')evidenceHashes[file]=await digest(path.join(dir,file));
const report='docs/audits/MFDA_P0_V2_INDEPENDENT_REAUDIT_2026-10-07.md';
const manifest={reviewedSHA:sha,reviewBranch:await git(['branch','--show-current']),v2TrackingSHA:await git(['rev-parse','origin/hardening/mfda-p0-closure-v2']),
  originalSHA:'c800392a3c57cb425dc9ab90ca3cda4893b2e5fd',firstRemediationSHA:'9f8c6de4a71955d3dceb937da93fe14ff5c39722',
  finalSupplied:await counts('security.txt'),finalIndependent:await counts('independent-acceptance.txt'),
  calc:{pass:244,fail:0,skipped:0,files:17},scanner:{pass:186,fail:0,skipped:0,files:12},
  build:{exit:0,evidence:'build-review.txt'},typecheck:JSON.parse(await readFile(path.join(dir,'baseline-typecheck-comparison.json'),'utf8')),
  suppliedRuntimeTotal:525,suppliedIndividualTotal:519,includingIndependentRuntimeTotal:547,includingIndependentIndividualTotal:538,
  verdicts:{blockerA:'PASS',blockerB:'PASS',p01:'CONDITIONAL PASS',p02:'FAIL',deploymentGate:'A. NOT SAFE TO DEPLOY'},
  sourceHashes,evidenceHashes,reportHash:await digest(path.join(root,report)),gitStatus:await git(['status','--short']),trackedDiffStat:await git(['diff','--stat'])};
await writeFile(path.join(dir,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');
console.log(JSON.stringify({reviewedSHA:sha,sourceFiles:files.length,finalSupplied:manifest.finalSupplied,finalIndependent:manifest.finalIndependent,trackedDiffStat:manifest.trackedDiffStat}));
