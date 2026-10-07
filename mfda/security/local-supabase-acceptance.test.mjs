import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import handler from '../netlify/functions/rent-estimate.mjs';

const exec = promisify(execFile);
const base = process.env.MFDA_LOCAL_SUPABASE_URL;
const anonKey = process.env.MFDA_LOCAL_ANON_KEY;
const jwtSecret = process.env.MFDA_LOCAL_JWT_SECRET;
const dbUrl = 'postgresql://postgres:postgres@127.0.0.1:55422/postgres';
assert.equal(base, 'http://127.0.0.1:55421', 'acceptance must target the loopback stack');
assert.ok(anonKey && jwtSecret, 'local synthetic keys are required at runtime');

const ids = {
  oa: 'a0000000-0000-4000-8000-000000000001',
  ob: 'b0000000-0000-4000-8000-000000000002',
  da: 'a1000000-0000-4000-8000-000000000001',
  db: 'b1000000-0000-4000-8000-000000000002',
  ua: 'a2000000-0000-4000-8000-000000000001',
  ub: 'b2000000-0000-4000-8000-000000000002',
  sa: 'a3000000-0000-4000-8000-000000000001',
  sb: 'b3000000-0000-4000-8000-000000000002',
  na: 'a4000000-0000-4000-8000-000000000001',
  nb: 'b4000000-0000-4000-8000-000000000002',
  la: 'a5000000-0000-4000-8000-000000000001',
  lb: 'b5000000-0000-4000-8000-000000000002',
};
const emails = {
  a: 'tenant-a@example.invalid', b: 'tenant-b@example.invalid', both: 'multi-org@example.invalid',
  revoked: 'revoked@example.invalid', none: 'no-membership@example.invalid', returning: 'returning@example.invalid',
  wrong: 'wrong-recipient@example.invalid', unverified: 'unverified@example.invalid', future: 'future-user@example.invalid',
};
const tokens = {};
const users = {};
const q = value => "'" + String(value).replaceAll("'", "''") + "'";

async function sql(statement) {
  const { stdout } = await exec('psql', ['-X', dbUrl, '-v', 'ON_ERROR_STOP=1', '-F', '|', '-Atc', statement], { maxBuffer: 16 * 1024 * 1024 });
  return stdout.trim();
}
async function sqlFile(file) {
  await exec('psql', ['-X', dbUrl, '-v', 'ON_ERROR_STOP=1', '-f', file], { maxBuffer: 16 * 1024 * 1024 });
}
async function request(path, { token, method = 'GET', body, headers = {} } = {}) {
  return fetch(base + path, {
    method,
    headers: {
      apikey: anonKey,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}
async function signup(name, email) {
  const response = await request('/auth/v1/signup', {
    method: 'POST', body: { email, password: 'Local-only-acceptance-2026!' },
  });
  assert.equal(response.status, 200, `local signup failed for ${email}`);
  const data = await response.json();
  assert.ok(data.access_token && data.user?.id, `local signup did not issue a session for ${email}`);
  users[name] = data.user.id;
  tokens[name] = data.access_token;
}
async function rows(table, token, query = 'select=*') {
  const response = await request(`/rest/v1/${table}?${query}`, { token });
  assert.equal(response.status, 200, `${table} read failed`);
  return response.json();
}
async function rpc(name, token, body) {
  return request(`/rest/v1/rpc/${name}`, { token, method: 'POST', body });
}
function signedJwt(sub, exp) {
  const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
  const head = encode({ alg: 'HS256', typ: 'JWT' });
  const payload = encode({ aud: 'authenticated', exp, sub, email: emails.a, role: 'authenticated' });
  const signature = createHmac('sha256', jwtSecret).update(`${head}.${payload}`).digest('base64url');
  return `${head}.${payload}.${signature}`;
}

test('MFDA local isolated Supabase acceptance', async t => {
  await t.test('pristine synthetic Auth and invitation fixtures', async () => {
    await sql(`
      select pg_notify('pgrst','reload schema');
      delete from auth.users where email like '%@example.invalid';
      insert into public.orgs(id,name) values
        (${q(ids.oa)},'Synthetic Tenant A'),(${q(ids.ob)},'Synthetic Tenant B');
      insert into public.invites(org_id,email,role,token,expires_at) values
        (${q(ids.oa)},${q(emails.a)},'admin',${q(randomUUID())},clock_timestamp()+interval '1 hour'),
        (${q(ids.ob)},${q(emails.b)},'member',${q(randomUUID())},clock_timestamp()+interval '1 hour'),
        (${q(ids.oa)},${q(emails.both)},'admin',${q(randomUUID())},clock_timestamp()+interval '1 hour'),
        (${q(ids.ob)},${q(emails.both)},'member',${q(randomUUID())},clock_timestamp()+interval '1 hour'),
        (${q(ids.oa)},${q(emails.revoked)},'member',${q(randomUUID())},clock_timestamp()+interval '1 hour');`);
    for (const [name, email] of Object.entries(emails)) await signup(name, email);
    assert.equal(await sql(`select count(*) from public.org_members where user_id=${q(users.a)} and org_id=${q(ids.oa)} and role='admin'`), '1');
    assert.equal(await sql(`select count(*) from public.org_members where user_id=${q(users.both)}`), '2');
    assert.equal(await sql(`select count(*) from public.org_members where user_id=${q(users.none)}`), '0');
    await sql(`delete from public.org_members where user_id=${q(users.revoked)} and org_id=${q(ids.oa)}`);
  });

  await t.test('actual Auth and PostgREST enforce tenant reads', async () => {
    await sql(`
      insert into public.deals(id,org_id,dedupe_key,address,status) values
        (${q(ids.da)},${q(ids.oa)},'a-only','A ONLY DEAL','analyzing'),
        (${q(ids.db)},${q(ids.ob)},'b-only','B ONLY DEAL','analyzing');
      insert into public.units(id,deal_id,org_id,type,count) values
        (${q(ids.ua)},${q(ids.da)},${q(ids.oa)},'A ONLY UNIT',1),
        (${q(ids.ub)},${q(ids.db)},${q(ids.ob)},'B ONLY UNIT',1);
      insert into public.scenarios(id,deal_id,org_id,label,inputs,outputs,calc_version) values
        (${q(ids.sa)},${q(ids.da)},${q(ids.oa)},'A ONLY SCENARIO','{}','{}','local'),
        (${q(ids.sb)},${q(ids.db)},${q(ids.ob)},'B ONLY SCENARIO','{}','{}','local');
      insert into public.notes(id,org_id,entity_type,entity_id,body) values
        (${q(ids.na)},${q(ids.oa)},'deal',${q(ids.da)},'A ONLY NOTE'),
        (${q(ids.nb)},${q(ids.ob)},'deal',${q(ids.db)},'B ONLY NOTE');
      insert into public.mail_lists(id,org_id,name) values
        (${q(ids.la)},${q(ids.oa)},'A ONLY LIST'),(${q(ids.lb)},${q(ids.ob)},'B ONLY LIST');
      insert into public.rent_estimates(org_id,addr_key,address,bedrooms,rent,source) values
        (${q(ids.oa)},'a-only-rent','A ONLY RENT',-1,1111,'rentcast'),
        (${q(ids.ob)},'b-only-rent','B ONLY RENT',-1,2222,'rentcast');`);
    const checks = [
      ['deals', 'address'], ['units', 'type'], ['scenarios', 'label'], ['notes', 'body'],
      ['mail_lists', 'name'], ['rent_estimates', 'address'],
    ];
    for (const [table, marker] of checks) {
      assert.deepEqual((await rows(table, tokens.a, `select=org_id,${marker}&order=${marker}`)).map(r => r[marker]), [`A ONLY ${marker === 'address' && table === 'deals' ? 'DEAL' : marker === 'address' ? 'RENT' : marker === 'type' ? 'UNIT' : marker === 'label' ? 'SCENARIO' : marker === 'body' ? 'NOTE' : 'LIST'}`]);
      assert.deepEqual((await rows(table, tokens.b, `select=org_id,${marker}&order=${marker}`)).map(r => r[marker]), [`B ONLY ${marker === 'address' && table === 'deals' ? 'DEAL' : marker === 'address' ? 'RENT' : marker === 'type' ? 'UNIT' : marker === 'label' ? 'SCENARIO' : marker === 'body' ? 'NOTE' : 'LIST'}`]);
    }
    assert.equal((await rows('deals', tokens.a, `select=id&org_id=eq.${ids.ob}`)).length, 0, 'forged org must return no rows');
    assert.equal((await rows('deals', tokens.none, 'select=id')).length, 0);
    assert.equal((await rows('deals', tokens.revoked, 'select=id')).length, 0);
    assert.deepEqual((await rows('deals', tokens.both, `select=address&org_id=eq.${ids.oa}`)).map(r => r.address), ['A ONLY DEAL']);
    assert.deepEqual((await rows('deals', tokens.both, `select=address&org_id=eq.${ids.ob}`)).map(r => r.address), ['B ONLY DEAL']);
    assert.deepEqual((await rows('deals', tokens.both, 'select=address&order=address')).map(r => r.address), ['A ONLY DEAL', 'B ONLY DEAL']);
    assert.equal((await rows('org_members', tokens.a, `select=org_id,user_id&org_id=eq.${ids.ob}`)).length, 0);
  });

  await t.test('anonymous and member role restrictions fail closed', async () => {
    assert.deepEqual(await rows('deals', undefined, 'select=id'), []);
    const anonymousWrite = await request('/rest/v1/deals', { method: 'POST', body: { org_id: ids.oa, dedupe_key: 'anonymous-forge' } });
    assert.ok([401, 403].includes(anonymousWrite.status));
    const memberInvite = await request('/rest/v1/invites', { token: tokens.b, method: 'POST', body: {
      org_id: ids.ob, email: 'forged@example.invalid', role: 'admin', expires_at: new Date(Date.now() + 3600000).toISOString(),
    } });
    assert.equal(memberInvite.status, 403);
    const memberOrgUpdate = await request(`/rest/v1/orgs?id=eq.${ids.ob}`, { token: tokens.b, method: 'PATCH', body: { name: 'FORGED' } });
    assert.ok([200, 204].includes(memberOrgUpdate.status));
    assert.equal(await sql(`select name from public.orgs where id=${q(ids.ob)}`), 'Synthetic Tenant B');
  });

  await t.test('invitation rejection, non-escalation, and valid returning user', async () => {
    const expired = randomUUID(), wrong = randomUUID(), consumed = randomUUID(), escalation = randomUUID(), valid = randomUUID();
    await sql(`insert into public.invites(org_id,email,role,token,expires_at,accepted_at) values
      (${q(ids.oa)},${q(emails.returning)},'member',${q(expired)},clock_timestamp()-interval '1 second',null),
      (${q(ids.oa)},'somebody-else@example.invalid','member',${q(wrong)},clock_timestamp()+interval '1 hour',null),
      (${q(ids.oa)},${q(emails.returning)},'member',${q(consumed)},clock_timestamp()+interval '1 hour',clock_timestamp()),
      (${q(ids.ob)},${q(emails.b)},'admin',${q(escalation)},clock_timestamp()+interval '1 hour',null),
      (${q(ids.ob)},${q(emails.returning)},'member',${q(valid)},clock_timestamp()+interval '1 hour',null);`);
    for (const token of [expired, wrong, consumed]) {
      const response = await rpc('redeem_invite', tokens.returning, { p_token: token });
      assert.equal(response.status, 403);
    }
    assert.ok([400, 404].includes((await rpc('redeem_invite', tokens.returning, { p_token: 'malformed' })).status));
    assert.ok([400, 404].includes((await rpc('redeem_invite', tokens.returning, { p_token: valid, p_org: ids.oa })).status));
    assert.ok([400, 404].includes((await rpc('redeem_invite', tokens.returning, { p_token: valid, p_role: 'admin' })).status));
    assert.equal((await rpc('redeem_invite', tokens.b, { p_token: escalation })).status, 200);
    assert.equal(await sql(`select role from public.org_members where org_id=${q(ids.ob)} and user_id=${q(users.b)}`), 'member');
    assert.equal((await rpc('redeem_invite', tokens.returning, { p_token: valid })).status, 200);
    assert.equal(await sql(`select count(*) from public.org_members where org_id=${q(ids.ob)} and user_id=${q(users.returning)}`), '1');
    assert.equal((await rpc('redeem_invite', tokens.returning, { p_token: valid })).status, 403);
  });

  await t.test('unverified identity and RPC exposure are rejected', async () => {
    const invite = randomUUID();
    await sql(`update auth.users set email_confirmed_at=null where id=${q(users.unverified)};
      insert into public.invites(org_id,email,role,token,expires_at) values (${q(ids.oa)},${q(emails.unverified)},'member',${q(invite)},clock_timestamp()+interval '1 hour')`);
    assert.equal((await rpc('redeem_invite', tokens.unverified, { p_token: invite })).status, 403);
    assert.equal(await sql(`select count(*) from public.org_members where user_id=${q(users.unverified)}`), '0');
    assert.ok([401, 403, 404].includes((await rpc('redeem_invite', undefined, { p_token: invite })).status));
    assert.ok([401, 403, 404].includes((await rpc('accept_mfda_invite', tokens.returning, { p_token: invite, p_user: users.unverified })).status));
  });

  await t.test('consumed invitation immutability and concurrency remain safe', async () => {
    const immutable = randomUUID(), concurrent = randomUUID();
    await sql(`insert into public.invites(org_id,email,role,token,expires_at,accepted_at) values
      (${q(ids.oa)},${q(emails.returning)},'admin',${q(immutable)},clock_timestamp()+interval '1 hour',clock_timestamp());
      insert into public.invites(org_id,email,role,token,expires_at) values
      (${q(ids.oa)},${q(emails.wrong)},'member',${q(concurrent)},clock_timestamp()+interval '1 hour');`);
    for (const body of [{ accepted_at: null }, { org_id: ids.ob }, { role: 'member' }]) {
      const response = await request(`/rest/v1/invites?token=eq.${immutable}`, { token: tokens.a, method: 'PATCH', body });
      assert.equal(response.status, 403);
    }
    const results = await Promise.all(Array.from({ length: 8 }, () => rpc('redeem_invite', tokens.wrong, { p_token: concurrent })));
    assert.equal(results.filter(r => r.status === 200).length, 1);
    assert.equal(results.filter(r => r.status === 403).length, 7);
    assert.equal(await sql(`select count(*) from public.org_members where user_id=${q(users.wrong)} and org_id=${q(ids.oa)}`), '1');
    assert.equal(await sql(`select count(*) from public.invites where token=${q(concurrent)} and accepted_at is not null`), '1');
  });

  await t.test('actual local proxy authorization stops before RentCast', async () => {
    const nativeFetch = globalThis.fetch;
    const rentcast = [];
    process.env.SUPABASE_URL = base;
    process.env.SUPABASE_ANON_KEY = anonKey;
    delete process.env.RENTCAST_API_KEY;
    globalThis.fetch = async (input, init) => {
      const url = new URL(input);
      if (url.hostname === 'api.rentcast.io') {
        rentcast.push({ url, init });
        throw new Error('RentCast must not be called');
      }
      return nativeFetch(input, init);
    };
    try {
      const invoke = (orgId, token, extra = {}) => handler(new Request(
        `http://127.0.0.1/.netlify/functions/rent-estimate?${new URLSearchParams({ ...(orgId === undefined ? {} : { orgId }), address: 'A ONLY PROXY ADDRESS', ...extra })}`,
        { headers: token === null ? {} : { Authorization: token?.startsWith('Bearer ') ? token : `Bearer ${token}` } },
      ));
      assert.equal((await invoke(ids.oa, null)).status, 401);
      assert.equal((await invoke(ids.oa, 'Basic malformed')).status, 401);
      assert.equal((await invoke(ids.oa, 'not-a-session')).status, 401);
      assert.equal((await invoke(ids.oa, signedJwt(users.a, Math.floor(Date.now() / 1000) - 60))).status, 401);
      assert.equal((await invoke(ids.oa, tokens.none)).status, 403);
      assert.equal((await invoke(ids.ob, tokens.a)).status, 403);
      assert.equal((await invoke(undefined, tokens.a)).status, 403);
      const valid = await invoke(ids.oa, tokens.a, { userId: users.b });
      assert.equal(valid.status, 501);
      const body = await valid.text();
      assert.doesNotMatch(body, /apikey|Bearer|SUPABASE|service.role|postgres|secret/i);
      assert.equal(rentcast.length, 0);
      assert.equal((await invoke(ids.oa, tokens.revoked)).status, 403);
    } finally {
      globalThis.fetch = nativeFetch;
      delete process.env.SUPABASE_URL;
      delete process.env.SUPABASE_ANON_KEY;
    }
  });

  await t.test('migration 015 repeat and historical membership behavior are explicit', async () => {
    const before = await sql(`select count(*) from public.org_members`);
    await sqlFile('supabase/migration_015_p0_invitation_authorization.sql');
    assert.equal(await sql(`select count(*) from public.org_members`), before);
    assert.match(await sql(`select pg_get_functiondef('public.bootstrap_new_user()'::regprocedure)`), /founder allowlist/);
    assert.equal(await sql(`select count(*) from public.org_members where user_id=${q(users.future)}`), '0', 'future uninvited user must remain unprivileged');
    await sql(`insert into public.org_members(org_id,user_id,role) values (${q(ids.oa)},${q(users.none)},'admin')`);
    await sqlFile('supabase/migration_015_p0_invitation_authorization.sql');
    assert.equal(await sql(`select role from public.org_members where org_id=${q(ids.oa)} and user_id=${q(users.none)}`), 'admin', '015 deliberately preserves historical memberships');
  });

  await t.test('consumed row and accepted_at survive invitation-author deletion', async () => {
    const preserved = randomUUID();
    await sql(`insert into public.invites(org_id,email,role,token,invited_by,accepted_at,expires_at)
      values (${q(ids.oa)},${q(emails.returning)},'member',${q(preserved)},${q(users.a)},clock_timestamp(),clock_timestamp()+interval '1 hour')`);
    await sql(`delete from auth.users where id=${q(users.a)}`);
    assert.equal(await sql(`select count(*) from public.invites where token=${q(preserved)} and accepted_at is not null and invited_by is null`), '1');
    assert.equal((await rpc('redeem_invite', tokens.returning, { p_token: preserved })).status, 403);
    assert.equal(await sql(`select count(*) from public.org_members where user_id=${q(users.returning)}`), '1');
  });

  await t.test('rent-estimate author FK remains bounded lifecycle debt', async () => {
    await sql(`update public.rent_estimates set created_by=${q(users.b)} where org_id=${q(ids.ob)}`);
    await assert.rejects(sql(`delete from auth.users where id=${q(users.b)}`), /rent_estimates_created_by_fkey/);
    assert.equal(await sql(`select count(*) from auth.users where id=${q(users.b)}`), '1');
  });
});
