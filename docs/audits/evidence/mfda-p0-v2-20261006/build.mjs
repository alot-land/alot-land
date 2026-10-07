import { build } from '/Users/davidastone/code/alot-land/alot-land/mfda/node_modules/vite/dist/node/index.js';
import { readFile, writeFile } from 'node:fs/promises';
const evidence = '/private/tmp/mfda-v2-verification';
const lines = [];
const logger = { info(s) { lines.push(s); }, warn(s) { lines.push(s); }, warnOnce(s) { lines.push(s); },
  error(s) { lines.push(s); }, clearScreen() {}, hasErrorLogged() { return false; }, hasWarned: false };
process.env.VITE_SUPABASE_URL = 'https://mfda-security.invalid';
process.env.VITE_SUPABASE_ANON_KEY = 'SYNTHETIC';
const result = JSON.parse(await readFile(evidence + '/results.json', 'utf8'));
try {
  await build({ root: '/Users/davidastone/code/alot-land/alot-land/mfda',
    configFile: '/Users/davidastone/code/alot-land/alot-land/mfda/vite.config.js', envFile: false,
    customLogger: logger, build: { outDir: evidence + '/frontend-build', emptyOutDir: true } });
  result.build.code = 0; lines.push('BUILD PASS (exit 0)');
} catch (error) { result.build.code = 1; lines.push(error.stack); }
await writeFile(evidence + '/build.txt', lines.join('\n') + '\n');
await writeFile(evidence + '/results.json', JSON.stringify(result, null, 2) + '\n');
console.log('build exit', result.build.code); process.exitCode = result.build.code;
