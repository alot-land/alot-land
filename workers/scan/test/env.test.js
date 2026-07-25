import { describe, it, expect } from 'vitest';
import { parseEnvFile } from '../lib/db.js';

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
