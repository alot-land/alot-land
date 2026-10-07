import { spawn, execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, readdir, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { build } from '/Users/davidastone/code/alot-land/alot-land/mfda/node_modules/vite/dist/node/index.js';
const repo = '/Users/davidastone/code/alot-land/alot-land';
const evidence = '/private/tmp/mfda-v2-verification';
await mkdir(evidence, { recursive: true });
const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(PG|SUPABASE|VITE_|DATABASE_URL)/.test(k)));
const results = {};
async function run(name, command, args, cwd) {
  const child = spawn(command, args, { cwd, env });
  let output = '';
  child.stdout.on('data', b => output += b); child.stderr.on('data', b => output += b);
  const code = await new Promise((resolve, reject) => { child.on('error', reject); child.on('close', resolve); });
  await writeFile(path.join(evidence, name + '.txt'), output);
  results[name] = { code, command: [command, ...args], cwd };
  const summary = output.split('\n').filter(s => /# (tests|pass|fail|cancelled|skipped)|Test Files|Tests  |error TS/.test(s));
  console.log(name, 'exit', code, summary.length > 12 ? summary.length + ' diagnostic/summary lines' : summary.join('\n'));
  return output;
}
const testFiles = (await readdir(repo + '/mfda/security')).filter(f => f.endsWith('.test.mjs')).sort().map(f => 'security/' + f);
if (process.argv.includes('--security-only')) {
  const priorSecurity = await readFile(evidence + '/security.txt', 'utf8');
  await writeFile(evidence + (priorSecurity.includes('shmget') ? '/security-sandbox.txt' : '/security-before-test-correction.txt'), priorSecurity);
  const previous = JSON.parse(await readFile(evidence + '/results.json', 'utf8'));
  await run('security', process.execPath, ['--test', '--test-concurrency=1', ...testFiles], repo + '/mfda');
  previous.security = results.security;
  await writeFile(evidence + '/results.json', JSON.stringify(previous, null, 2) + '\n');
  process.exit(results.security.code);
}
const baseline = 'c800392a3c57cb425dc9ab90ca3cda4893b2e5fd';
const extracted = await mkdtemp('/private/tmp/mfda-v2-baseline-');
const files = execFileSync('git', ['ls-tree', '-r', '--name-only', baseline, 'packages/mf-calc'], { cwd: repo, encoding: 'utf8' }).trim().split('\n');
for (const file of files) {
  await mkdir(path.dirname(path.join(extracted, file)), { recursive: true });
  await writeFile(path.join(extracted, file), execFileSync('git', ['show', baseline + ':' + file], { cwd: repo }));
}
await symlink(repo + '/packages/mf-calc/node_modules', extracted + '/packages/mf-calc/node_modules');
const checks = await Promise.allSettled([
  run('security', process.execPath, ['--test', '--test-concurrency=1', ...testFiles], repo + '/mfda'),
  run('calc', 'npm', ['test'], repo + '/packages/mf-calc'),
  run('scanner', 'npm', ['test'], repo + '/workers/scan'),
  run('typecheck', 'npm', ['run', 'typecheck'], repo + '/packages/mf-calc'),
  run('baseline-typecheck', 'npm', ['run', 'typecheck'], extracted + '/packages/mf-calc'),
]);
for (const result of checks) if (result.status === 'rejected') throw result.reason;
const current = await readFile(evidence + '/typecheck.txt', 'utf8');
const original = await readFile(evidence + '/baseline-typecheck.txt', 'utf8');
results.typecheckComparison = { identical: current === original, currentDiagnostics: (current.match(/error TS/g) ?? []).length,
  baselineDiagnostics: (original.match(/error TS/g) ?? []).length, baseline, extracted };
console.log('typecheck comparison', JSON.stringify(results.typecheckComparison));
process.env.VITE_SUPABASE_URL = 'https://mfda-security.invalid';
process.env.VITE_SUPABASE_ANON_KEY = 'SYNTHETIC';
const buildLines = [];
const logger = {
  info(message) { buildLines.push(message); }, warn(message) { buildLines.push(message); },
  warnOnce(message) { buildLines.push(message); }, error(message) { buildLines.push(message); },
  clearScreen() {}, hasErrorLogged() { return false; }, hasWarned: false,
};
try {
  await build({ root: repo + '/mfda', configFile: repo + '/mfda/vite.config.js', envFile: false,
    customLogger: logger, build: { outDir: evidence + '/frontend-build' } });
  results.build = { code: 0, envFile: false, supabase: 'synthetic', outDir: evidence + '/frontend-build' };
  buildLines.push('BUILD PASS (exit 0)');
} catch (error) { results.build = { code: 1 }; buildLines.push(error.stack); }
await writeFile(evidence + '/build.txt', buildLines.join('\n') + '\n');
await writeFile(evidence + '/results.json', JSON.stringify(results, null, 2) + '\n');
console.log('build exit', results.build.code, 'evidence', evidence);
process.exitCode = results.security.code || results.calc.code || results.scanner.code || results.build.code
  || Number(!results.typecheckComparison.identical || results.typecheckComparison.currentDiagnostics !== 35);
