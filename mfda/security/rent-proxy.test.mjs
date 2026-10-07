import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import handler from '../netlify/functions/rent-estimate.mjs';
import { database, ids, quote as q } from './db-harness.mjs';

const token = 'SYNTHETIC-OPAQUE-A-TOKEN';
const secret = 'SYNTHETIC-SERVER-ONLY-RENTCAST-SECRET';
function fixture(t, options = {}) {
  const names = ['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY', 'RENTCAST_API_KEY'];
  const prior = names.map(name => [name, process.env[name]]);
  Object.assign(process.env, { SUPABASE_URL: 'https://synthetic-auth.invalid', SUPABASE_ANON_KEY: 'SYNTHETIC-PUBLIC-ANON',
    VITE_SUPABASE_URL: '', VITE_SUPABASE_ANON_KEY: '', SUPABASE_SERVICE_ROLE_KEY: 'SYNTHETIC-UNUSED-SERVICE-ROLE', RENTCAST_API_KEY: secret });
  t.after(() => prior.forEach(([name, value]) => { if (value === undefined) delete process.env[name]; else process.env[name] = value; }));
  const calls = [], upstream = [];
  t.mock.method(globalThis, 'fetch', async (input, init) => {
    const url = new URL(input);
    calls.push({ url, init });
    if (url.hostname === 'api.rentcast.io') {
      upstream.push({ url, init });
      if (options.upstreamThrow) throw new Error(secret);
      return new Response(JSON.stringify(options.upstreamBody ?? { rent: 1731, rentRangeLow: 1600, comparables: [{}] }), { status: options.upstreamStatus ?? 200 });
    }
    assert.equal(url.origin, 'https://synthetic-auth.invalid');
    assert.equal(init.headers.apikey, 'SYNTHETIC-PUBLIC-ANON');
    assert.equal(init.redirect, 'error');
    assert.equal(init.cache, 'no-store');
    if (options.throwAuth) throw new Error(secret);
    if (url.pathname === '/auth/v1/user') {
      if (init.headers.Authorization !== `Bearer ${token}`) return Response.json({ message: secret }, { status: 401 });
      return Response.json(options.authBody ?? { id: ids.a }, { status: options.authStatus ?? 200 });
    }
    assert.equal(url.pathname, '/rest/v1/org_members');
    assert.equal(url.searchParams.get('user_id'), 'eq.' + ids.a, 'use verified Auth user, never caller userId');
    assert.equal(url.searchParams.get('select'), 'org_id,user_id');
    if (options.membershipRead) return options.membershipRead(url);
    return Response.json(options.rows ?? [{ org_id: ids.oa, user_id: ids.a }], { status: options.membershipStatus ?? 200 });
  });
  const invoke = (params = {}, auth = `Bearer ${token}`, method = 'GET') => handler(new Request(
    'http://localhost/.netlify/functions/rent-estimate?' + new URLSearchParams({ orgId: ids.oa, address: 'A SYNTHETIC ADDRESS', ...params }),
    { method, headers: auth ? { Authorization: auth } : {} }));
  async function denied(status, params, auth, method) {
    const response = await invoke(params, auth, method);
    assert.equal(response.status, status);
    const body = await response.text();
    assert.equal(JSON.parse(body).rentcast_contacted, false);
    assert.doesNotMatch(body, /SYNTHETIC-|apikey|stack|Bearer|Authorization:|synthetic-auth/);
    assert.equal(upstream.length, 0, 'denial must never invoke RentCast');
    assert.equal(response.headers.get('cache-control'), 'no-store');
    return response;
  }
  return { calls, upstream, invoke, denied };
}

test('rent proxy requires trusted user and organization authorization', async t => {
  await t.test('missing bearer rejects before any external request', async t => {
    const f = fixture(t); await f.denied(401, {}, null); assert.equal(f.calls.length, 0);
  });
  await t.test('malformed bearer rejects before any external request', async t => {
    const f = fixture(t); await f.denied(401, {}, 'Basic forged'); assert.equal(f.calls.length, 0);
  });
  for (const value of ['SYNTHETIC-INVALID-TOKEN', 'SYNTHETIC-EXPIRED-SESSION']) {
    await t.test('Auth rejects ' + value, async t => { await fixture(t).denied(401, {}, 'Bearer ' + value); });
  }
  await t.test('authenticated user with no membership rejects', async t => { await fixture(t, { rows: [] }).denied(403); });
  await t.test('forged org rejects even with claimed userId', async t => { await fixture(t, { rows: [] }).denied(403, { orgId: ids.ob, userId: ids.b }); });
  await t.test('missing and malformed org fail closed', async t => {
    const f = fixture(t); await f.denied(403, { orgId: '' }); await f.denied(403, { orgId: 'forged&org' }); assert.equal(f.calls.length, 0);
  });
  await t.test('membership response must match both verified user and org', async t => {
    await fixture(t, { rows: [{ org_id: ids.ob, user_id: ids.a }, { org_id: ids.oa, user_id: ids.b }] }).denied(403);
  });
  await t.test('valid authorized user/org succeeds and identity never reaches RentCast', async t => {
    const f = fixture(t); const response = await f.invoke({ userId: ids.b, bedrooms: '2', squareFootage: '850' });
    assert.equal(response.status, 200); assert.equal((await response.json()).rent, 1731);
    assert.equal(f.calls.length, 3); assert.equal(f.upstream.length, 1);
    const { url, init } = f.upstream[0];
    assert.equal(url.searchParams.get('address'), 'A SYNTHETIC ADDRESS');
    assert.equal(url.searchParams.get('orgId'), null); assert.equal(url.searchParams.get('userId'), null);
    assert.equal(init.headers.Authorization, undefined); assert.equal(init.headers.apikey, undefined);
    assert.equal(init.headers['X-Api-Key'], secret);
  });
  for (const options of [{ throwAuth: true }, { authStatus: 500 }, { membershipStatus: 500 }, { rows: { message: secret } }]) {
    await t.test('authorization infrastructure failure is generic and closed ' + JSON.stringify(Object.keys(options)), async t => {
      await fixture(t, options).denied(503);
    });
  }
  await t.test('untrusted Auth response with no user rejects', async t => { await fixture(t, { authBody: {} }).denied(401); });
  await t.test('missing trusted configuration rejects', async t => {
    const f = fixture(t); delete process.env.SUPABASE_URL; await f.denied(503); assert.equal(f.calls.length, 0);
  });
  await t.test('missing RentCast key and address are never metered', async t => {
    const f = fixture(t); delete process.env.RENTCAST_API_KEY; await f.denied(501);
    process.env.RENTCAST_API_KEY = secret; await f.denied(400, { address: '' });
  });
  await t.test('unsupported method never contacts Auth or RentCast', async t => {
    const f = fixture(t); await f.denied(405, {}, undefined, 'POST'); assert.equal(f.calls.length, 0);
  });
  for (const options of [{ upstreamStatus: 401, upstreamBody: { message: secret } }, { upstreamStatus: 403, upstreamBody: { message: secret } }, { upstreamThrow: true }]) {
    await t.test('upstream failures cannot expose credentials ' + JSON.stringify(Object.keys(options)) + (options.upstreamStatus ?? ''), async t => {
      const f = fixture(t, options); const response = await f.invoke();
      assert.equal(response.status, 502); const body = await response.text();
      assert.doesNotMatch(body, /SYNTHETIC-|characters|apikey|stack/);
      assert.equal(JSON.parse(body).rentcast_contacted, true); assert.equal(f.upstream.length, 1);
    });
  }
  await t.test('server secret and service-role references absent from browser sources', async () => {
    for (const file of ['src/lib/queries.js', 'src/lib/supabase.js', 'src/components/RentEstimator.jsx']) {
      const source = await readFile(new URL('../' + file, import.meta.url), 'utf8');
      assert.doesNotMatch(source, /SERVICE_ROLE|RENTCAST_API_KEY|X-Api-Key/);
    }
    const server = await readFile(new URL('../netlify/functions/rent-estimate.mjs', import.meta.url), 'utf8');
    assert.doesNotMatch(server, /SUPABASE_SERVICE_ROLE_KEY/);
  });
  await t.test('membership authorization uses real local authenticated RLS', async t => {
    const db = await database(); t.after(() => db.close());
    const f = fixture(t, { membershipRead: async url => {
      const org = url.searchParams.get('org_id').slice(3);
      const rows = JSON.parse(await db.sql(`select coalesce(jsonb_agg(jsonb_build_object('org_id',org_id,'user_id',user_id)),'[]')
        from public.org_members where org_id=${q(org)} and user_id=${q(ids.a)}`, ids.a));
      return Response.json(rows);
    } });
    await f.denied(403, { orgId: ids.ob });
    assert.equal((await f.invoke()).status, 200);
    await db.sql(`delete from public.org_members where user_id=${q(ids.a)} and org_id=${q(ids.oa)}`);
    const before = f.upstream.length;
    assert.equal((await f.invoke()).status, 403); assert.equal(f.upstream.length, before);
  });
});
