// Local/synthetic verification only. No dotenv, hosted clients or RentCast.
import { spawn, execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, readdir, symlink, writeFile, rename } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const evidence = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(evidence, '../../../..');
const temp = await mkdtemp('/private/tmp/mfda-v3-verification-');
const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(PG|SUPABASE|VITE_|DATABASE_URL|RENTCAST)/.test(k)));
const finish = process.argv.includes('--finish');
const results = finish ? JSON.parse(await readFile(path.join(evidence,'results.json'),'utf8')) : {};
async function run(name, command, args, cwd) {
  const stream = createWriteStream(path.join(evidence,name+'.txt'));
  const child = spawn(command, args, { cwd, env }); let output = '';
  child.stdout.on('data', b => { output += b; stream.write(b); }); child.stderr.on('data', b => { output += b; stream.write(b); });
  const code = await new Promise((resolve, reject) => { child.on('error', reject); child.on('close', resolve); });
  await new Promise(resolve => stream.end(resolve));
  results[name] = { code, command: [command, ...args], cwd };
  const summary = output.split('\n').filter(s => /# (tests|pass|fail|cancelled|skipped)|Test Files|Tests  |error TS/.test(s));
  console.log(name, 'exit', code, summary.length > 12 ? summary.length + ' diagnostic/summary lines' : summary.join('\n'));
  return output;
}

// Preserve all second-review diagnostics. Strengthen only its two expected-
// vulnerability assertions: a safe build must now suppress/reject N-1.
if (!finish) {
const review = 'audit/mfda-p0-v2-independent-reaudit';
let independent = execFileSync('git', ['show', review + ':docs/audits/evidence/mfda-p0-v2-independent-20261007/independent.test.mjs'], { cwd: repo, encoding: 'utf8' });
function replaceOnce(before, after) {
  if (independent.split(before).length !== 2) throw new Error('independent diagnostic transformation mismatch: ' + before);
  independent = independent.replace(before, () => after);
}
replaceOnce('NEW LIFECYCLE GAP: A cache miss completed under B initiates A-address RentCast proxy request', 'V3 regression: A cache miss completed under B cannot initiate RentCast');
replaceOnce("await f.page.getByRole('button',{name:/Address-level \\(RentCast\\)/}).click(); await start;",
  "await f.page.getByRole('button',{name:/Address-level \\(RentCast\\)/}).evaluate(e=>{window.reviewRentAction=e[Object.keys(e).find(k=>k.startsWith('__reactProps$'))].onClick();}); await start;");
const start = independent.indexOf('      release(); await until(()=>outbound.length===1);');
const end = independent.indexOf('\n    } finally { release(); await f.ctx.close(); }', start);
if (start < 0 || end < 0) throw new Error('independent N-1 block missing');
independent = independent.slice(0, start) + `      release(); await f.page.evaluate(()=>window.reviewRentAction); await frames(f.page);
      assert.deepEqual(outbound,[]); assert.deepEqual(writes,[]);
      assert.doesNotMatch(await f.page.locator('body').innerText(),/A ONLY|9,876/);
      await record({probe:'stale-rentcast-v3',outbound,writes,externalCallInitiatedAfterB:false});` + independent.slice(end);
replaceOnce('NEW SERVER GAP: real RentCast handler forwards an unauthenticated request (synthetic upstream only)', 'V3 regression: real RentCast handler rejects unauthenticated request before upstream');
replaceOnce('assert.equal(result.status,200);assert.equal(calls.length,1);', 'assert.equal(result.status,401);assert.equal(calls.length,0);');
replaceOnce("    assert.match(calls[0].url,/A\\+ONLY\\+SECURITY\\+CANARY/);assert.equal((await result.json()).rent,1234);",
  "    assert.equal((await result.json()).error,'unauthorized');");
replaceOnce("await record({probe:'rentcast-handler-no-auth',status:200,upstreamCalls:calls.length,synthetic:true});",
  "await record({probe:'rentcast-handler-no-auth-v3',status:401,upstreamCalls:calls.length,synthetic:true});");
await writeFile(path.join(evidence, 'independent-regression.test.mjs'), independent);
await writeFile(path.join(evidence, 'csv-pages.test.mjs'), execFileSync('git', ['show', review + ':docs/audits/evidence/mfda-p0-v2-independent-20261007/csv-pages.test.mjs'], { cwd: repo }));

const baseline = 'c800392a3c57cb425dc9ab90ca3cda4893b2e5fd';
const extracted = path.join(temp, 'baseline');
const files = execFileSync('git', ['ls-tree','-r','--name-only',baseline,'packages/mf-calc'], { cwd: repo, encoding: 'utf8' }).trim().split('\n');
for (const file of files) {
  await mkdir(path.dirname(path.join(extracted, file)), { recursive: true });
  await writeFile(path.join(extracted, file), execFileSync('git', ['show', baseline + ':' + file], { cwd: repo }));
}
await symlink(repo + '/packages/mf-calc/node_modules', extracted + '/packages/mf-calc/node_modules');
const testFiles = (await readdir(repo + '/mfda/security')).filter(f => f.endsWith('.test.mjs')).sort().map(f => 'security/' + f);
const checks = await Promise.allSettled([
  run('security', process.execPath, ['--test','--test-concurrency=1',...testFiles], repo + '/mfda'),
  run('calc', 'npm', ['test'], repo + '/packages/mf-calc'),
  run('scanner', 'npm', ['test'], repo + '/workers/scan'),
  run('typecheck', 'npm', ['run','typecheck'], repo + '/packages/mf-calc'),
  run('baseline-typecheck', 'npm', ['run','typecheck'], extracted + '/packages/mf-calc'),
]);
for (const check of checks) if (check.status === 'rejected') throw check.reason;
// Vite 6 treats port 0 as its default port. Keep the two browser runners
// sequential, since the inherited harness requires strictPort.
await run('independent', process.execPath, ['--test','--test-concurrency=1',path.join(evidence,'independent-regression.test.mjs'),path.join(evidence,'csv-pages.test.mjs')], repo + '/mfda');
const current = await readFile(path.join(evidence,'typecheck.txt'),'utf8');
const original = await readFile(path.join(evidence,'baseline-typecheck.txt'),'utf8');
results.typecheckComparison = { identical: current === original, currentDiagnostics: (current.match(/error TS/g) ?? []).length,
  baselineDiagnostics: (original.match(/error TS/g) ?? []).length, baseline, extracted };
console.log('typecheck comparison', JSON.stringify(results.typecheckComparison));
} else {
  await rename(path.join(evidence,'security.txt'),path.join(evidence,'security-infrastructure.txt'));
  await rename(path.join(evidence,'build.txt'),path.join(evidence,'build-first.txt'));
  const testFiles = (await readdir(repo + '/mfda/security')).filter(f => f.endsWith('.test.mjs')).sort().map(f => 'security/' + f);
  await run('security', process.execPath, ['--test','--test-concurrency=1',...testFiles], repo + '/mfda');
}

// Fresh build in the frontend cwd with all environment-file loading disabled.
process.chdir(repo + '/mfda');
for (const name of Object.keys(process.env)) if (/^(SUPABASE|VITE_|RENTCAST)/.test(name)) delete process.env[name];
Object.assign(process.env, { VITE_SUPABASE_URL: 'https://mfda-security.invalid', VITE_SUPABASE_ANON_KEY: 'SYNTHETIC',
  RENTCAST_API_KEY: 'SYNTHETIC-BUILD-SERVER-RENTCAST-SECRET', SUPABASE_SERVICE_ROLE_KEY: 'SYNTHETIC-BUILD-SERVICE-ROLE-SECRET' });
const { build } = await import(path.join(repo,'mfda/node_modules/vite/dist/node/index.js'));
const lines = [];
const logger = { info(s) { lines.push(s); }, warn(s) { lines.push(s); }, warnOnce(s) { lines.push(s); },
  error(s) { lines.push(s); }, clearScreen() {}, hasErrorLogged() { return false; }, hasWarned: false };
try {
  const outDir = path.join(temp,'frontend-build');
  await build({ root: repo + '/mfda', configFile: repo + '/mfda/vite.config.js', envDir: false, customLogger: logger, build: { outDir } });
  async function scan(dir) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const p = path.join(dir,entry.name); if (entry.isDirectory()) await scan(p);
      else if (/\.(js|html|css|map)$/.test(entry.name)) {
        const source = await readFile(p,'utf8');
        if (/SYNTHETIC-BUILD-(SERVER-RENTCAST|SERVICE-ROLE)-SECRET|SUPABASE_SERVICE_ROLE_KEY|X-Api-Key|api\.rentcast\.io/.test(source)) throw new Error('server secret reference leaked into build');
      }
    }
  }
  await scan(outDir);
  results.build = { code: 0, envDir: false, outDir, serverSecretScan: 'PASS' }; lines.push('BUILD PASS; browser server-secret scan PASS');
} catch (e) { results.build = { code: 1 }; lines.push(e.stack); }
await writeFile(path.join(evidence,'build.txt'),lines.join('\n')+'\n');
await writeFile(path.join(evidence,'results.json'),JSON.stringify(results,null,2)+'\n');
console.log('build exit',results.build.code,'evidence',evidence);
process.exitCode = results.security.code || results.independent.code || results.calc.code || results.scanner.code || results.build.code
  || Number(!results.typecheckComparison.identical || results.typecheckComparison.currentDiagnostics !== 35);
