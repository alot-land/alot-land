import { describe, it, expect, afterEach } from 'vitest';
import { writeFileSync, rmSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseEnvFile, loadEnvFile } from '../lib/db.js';

describe('parseEnvFile', () => {
  it('reads KEY=value pairs, ignoring comments and blanks', () => {
    const env = parseEnvFile(`
# Supabase
SUPABASE_URL=https://abc.supabase.co

SUPABASE_SERVICE_ROLE_KEY=sb_secret_xyz
MFDA_ORG_ID = 1234
`);
    expect(env.SUPABASE_URL).toBe('https://abc.supabase.co');
    expect(env.SUPABASE_SERVICE_ROLE_KEY).toBe('sb_secret_xyz');
    // Spaces around '=' are tolerated — hand-edited .env files have them.
    expect(env.MFDA_ORG_ID).toBe('1234');
  });

  it('strips matched surrounding quotes but keeps inner ones', () => {
    const env = parseEnvFile(`A="quoted"\nB='single'\nC=un"quoted`);
    expect(env.A).toBe('quoted');
    expect(env.B).toBe('single');
    expect(env.C).toBe('un"quoted');
  });

  it('ignores lines that are not assignments', () => {
    expect(parseEnvFile('just some text\n# KEY=value\n=novalue')).toEqual({});
  });
});

describe('loadEnvFile', () => {
  const added = [];
  let dir;

  function envFile(contents) {
    dir = mkdtempSync(join(tmpdir(), 'mfda-env-'));
    const p = join(dir, '.env');
    writeFileSync(p, contents);
    return p;
  }

  afterEach(() => {
    for (const k of added.splice(0)) delete process.env[k];
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = null;
  });

  it('populates variables that are not already set', () => {
    added.push('MFDA_TEST_TOKEN');
    expect(loadEnvFile(envFile('MFDA_TEST_TOKEN=from_file\n'))).toBe(true);
    expect(process.env.MFDA_TEST_TOKEN).toBe('from_file');
  });

  it('never overrides a value already in the environment', () => {
    // An exported shell value or a cron environment must always win.
    added.push('MFDA_TEST_TOKEN');
    process.env.MFDA_TEST_TOKEN = 'from_shell';
    loadEnvFile(envFile('MFDA_TEST_TOKEN=from_file\n'));
    expect(process.env.MFDA_TEST_TOKEN).toBe('from_shell');
  });

  it('reports a missing file instead of throwing', () => {
    expect(loadEnvFile(join(tmpdir(), 'definitely-not-here', '.env'))).toBe(false);
  });

  it('runs at import time, not only inside makeDb', () => {
    // The bug this guards: bin/hudfmr.mjs read process.env.HUD_API_TOKEN at
    // module top level and exited "Set HUD_API_TOKEN" before makeDb() — then
    // the only caller of loadEnvFile — was ever reached, with the token
    // sitting in .env the whole time. ES imports evaluate before the
    // importing module's body, so a TOP-LEVEL call here fixes every script.
    // Move it back inside a function and this fails.
    const src = readFileSync(new URL('../lib/db.js', import.meta.url), 'utf8');
    expect(/^loadEnvFile\(\);$/m.test(src)).toBe(true);
  });
});
