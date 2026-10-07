import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, writeFile, readFile, symlink } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const exec = promisify(execFile);
const root = fileURLToPath(new URL('../../../../', import.meta.url));
const temp = await mkdtemp('/private/tmp/mfda-v2-independent-baseline-');
const baseline = 'c800392a3c57cb425dc9ab90ca3cda4893b2e5fd';
const { stdout } = await exec('git',['ls-tree','-r','--name-only',baseline,'--','packages/mf-calc'],{cwd:root});
for(const file of stdout.trim().split('\n')) {
  const content = await exec('git',['show',baseline+':'+file],{cwd:root,encoding:'buffer',maxBuffer:16*1024*1024});
  const dest=path.join(temp,file); await mkdir(path.dirname(dest),{recursive:true}); await writeFile(dest,content.stdout);
}
await symlink(path.join(root,'packages/mf-calc/node_modules'),path.join(temp,'packages/mf-calc/node_modules'));
let code=0, log;
try { const result=await exec('npm',['run','typecheck'],{cwd:path.join(temp,'packages/mf-calc'),maxBuffer:16*1024*1024}); log=result.stdout+result.stderr; }
catch(e) { code=e.code; log=e.stdout+e.stderr; }
await writeFile(new URL('./baseline-typecheck.txt',import.meta.url),log);
const current=await readFile(new URL('./typecheck.txt',import.meta.url),'utf8');
const comparison={baseline, directory:temp, exit:code, diagnostics:(log.match(/error TS/g)||[]).length, byteIdentical:log===current};
await writeFile(new URL('./baseline-typecheck-comparison.json',import.meta.url),JSON.stringify(comparison,null,2)+'\n');
console.log(JSON.stringify(comparison));
if(code!==2 || comparison.diagnostics!==35 || !comparison.byteIdentical) process.exitCode=1;
