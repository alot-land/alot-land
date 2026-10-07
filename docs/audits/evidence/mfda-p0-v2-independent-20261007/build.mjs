import { build } from '../../../../mfda/node_modules/vite/dist/node/index.js';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../../../../mfda/', import.meta.url));
process.chdir(root);
process.env.VITE_SUPABASE_URL = 'https://mfda-security.invalid';
process.env.VITE_SUPABASE_ANON_KEY = 'SYNTHETIC';
await build({ root, configFile: root + 'vite.config.js', envFile: false,
  build: { outDir: '/private/tmp/mfda-p0-v2-independent-20261007-build', emptyOutDir: true } });
console.log('BUILD PASS (exit 0; synthetic config, environment files disabled)');
