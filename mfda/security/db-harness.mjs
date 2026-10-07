// Disposable local PostgreSQL only. No database URL or production environment.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, readdir, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const exec = promisify(execFile);
export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cleanEnv = () => Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^PG|SUPABASE|VITE_SUPABASE/.test(k)));
export const quote = (value) => "'" + String(value).replaceAll("'", "''") + "'";
export const ids = { a: '10000000-0000-0000-0000-000000000001', b: '10000000-0000-0000-0000-000000000002', both: '10000000-0000-0000-0000-000000000003', admin: '10000000-0000-0000-0000-000000000004', oa: '20000000-0000-0000-0000-000000000001', ob: '20000000-0000-0000-0000-000000000002', deal: '30000000-0000-0000-0000-000000000001', parcel: '40000000-0000-0000-0000-000000000001' };
export async function database({ baseline = false } = {}) {
  const dir = await realpath(await mkdtemp(path.join(tmpdir(), 'mfda-security-')));
  const env = cleanEnv();
  const data = path.join(dir, 'data');
  let started = false;
  async function sql(text, user) {
    const prefix = user ? `set role authenticated; set "test.uid" = ${quote(user)}; ` : '';
    const { stdout } = await exec('psql', ['-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-h', dir, '-p', '55448', '-d', 'postgres', '-c', prefix + text], { env, maxBuffer: 16 * 1024 * 1024 });
    return stdout.trim();
  }
  async function close() {
    if (started) await exec('pg_ctl', ['-D', data, 'stop', '-m', 'fast'], { env });
    await rm(dir, { recursive: true, force: true });
  }
  try {
    await exec('initdb', ['-D', data, '-A', 'trust', '--no-locale', '-E', 'UTF8'], { env });
    // Socket in a unique temporary directory. TCP completely disabled.
    await exec('pg_ctl', ['-D', data, '-l', path.join(dir, 'server.log'), '-o', `-k ${dir} -p 55448 -h ''`, 'start'], { env });
    started = true;
    await sql(`create role authenticated nologin; create role anon nologin;
      create schema auth;
      create table auth.users(id uuid primary key, email text, email_confirmed_at timestamptz);
      create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.uid',true),'')::uuid $$;
      create function auth.jwt() returns jsonb language sql stable as $$ select jsonb_build_object('email',(select email from auth.users where id=auth.uid())) $$;
      create schema storage; create table storage.buckets(id text primary key,name text,public boolean);
      grant usage on schema public,auth to authenticated,anon;`);
    const files = ['schema.sql', ...(await readdir(path.join(root, 'supabase'))).filter((f) => /^migration_.*\.sql$/.test(f)).sort()];
    for (const file of files) {
      if (baseline && file.startsWith('migration_015')) continue;
      await sql(await readFile(path.join(root, 'supabase', file), 'utf8'));
    }
    await sql(`grant select,insert,update,delete on all tables in schema public to authenticated;
      grant select on auth.users to authenticated;
      insert into public.orgs(id,name) values (${quote(ids.oa)},'Synthetic Tenant A'),(${quote(ids.ob)},'Synthetic Tenant B');
      insert into auth.users(id,email,email_confirmed_at) values
        (${quote(ids.a)},'a@example.invalid',clock_timestamp()),(${quote(ids.b)},'b@example.invalid',clock_timestamp()),
        (${quote(ids.both)},'both@example.invalid',clock_timestamp()),(${quote(ids.admin)},'admin@example.invalid',clock_timestamp());
      -- The old bootstrap creates personal orgs. Keep fixture memberships
      -- identical across controls and remediation before granting test access.
      delete from public.orgs where id in (select org_id from public.org_members
        where user_id in (${quote(ids.a)},${quote(ids.b)},${quote(ids.both)},${quote(ids.admin)}));
      insert into public.org_members(org_id,user_id,role) values
        (${quote(ids.oa)},${quote(ids.a)},'member'),(${quote(ids.ob)},${quote(ids.b)},'member'),
        (${quote(ids.oa)},${quote(ids.both)},'admin'),(${quote(ids.ob)},${quote(ids.both)},'member'),
        (${quote(ids.oa)},${quote(ids.admin)},'admin');
      insert into public.deals(id,org_id,dedupe_key,address,status,price,units_count) values
        (${quote(ids.deal)},${quote(ids.oa)},'security-canary','A ONLY SECURITY CANARY','analyzing',500000,4);
      insert into public.parcels(id,org_id,state,county_fips,apn,dedupe_key,situs_address,units) values
        (${quote(ids.parcel)},${quote(ids.oa)},'AZ','04013','SECURITY','security-parcel','A ONLY PARCEL CANARY',4);`);
    return { sql, close, dir };
  } catch (error) { await close(); throw error; }
}
