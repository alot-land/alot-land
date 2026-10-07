import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';
import { createServer } from 'vite';
import handler from '../netlify/functions/rent-estimate.mjs';

const exec = promisify(execFile);
const appRoot = path.resolve(new URL('..', import.meta.url).pathname);
const localBase = process.env.MFDA_LOCAL_SUPABASE_URL;
const anonKey = process.env.MFDA_LOCAL_ANON_KEY;
const dbUrl = 'postgresql://postgres:postgres@127.0.0.1:55422/postgres';
assert.equal(localBase, 'http://127.0.0.1:55421');
assert.ok(anonKey);

const ids = {
  oa: 'c0000000-0000-4000-8000-000000000001', ob: 'd0000000-0000-4000-8000-000000000002',
  da: 'c1000000-0000-4000-8000-000000000001', db: 'd1000000-0000-4000-8000-000000000002',
};
const q = value => "'" + String(value).replaceAll("'", "''") + "'";
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
async function sql(statement) {
  const { stdout } = await exec('psql', ['-X', dbUrl, '-v', 'ON_ERROR_STOP=1', '-Atc', statement], { maxBuffer: 16 * 1024 * 1024 });
  return stdout.trim();
}
async function api(pathname, { method = 'GET', body, token } = {}) {
  return fetch(localBase + pathname, {
    method,
    headers: { apikey: anonKey, ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
}
async function signup(email) {
  const response = await api('/auth/v1/signup', { method: 'POST', body: { email, password: 'Local-rent-browser-2026!' } });
  assert.equal(response.status, 200, `signup failed for ${email}`);
  const data = await response.json();
  assert.ok(data.access_token && data.refresh_token && data.user?.id);
  return { access_token: data.access_token, refresh_token: data.refresh_token, user: data.user };
}

test('RentEstimator uses the actual local Supabase stack across tenant transitions', async t => {
  const temp = await mkdtemp(path.join(tmpdir(), 'mfda-local-rent-'));
  let browser, server;
  t.after(async () => {
    await browser?.close();
    await server?.close();
    await rm(temp, { recursive: true, force: true });
  });
  const emails = { a: 'rent-a@example.invalid', b: 'rent-b@example.invalid', both: 'rent-multi@example.invalid' };
  await sql(`
    delete from public.orgs where id in (${q(ids.oa)},${q(ids.ob)});
    delete from auth.users where email in (${q(emails.a)},${q(emails.b)},${q(emails.both)});
    insert into public.orgs(id,name) values (${q(ids.oa)},'Synthetic Tenant A'),(${q(ids.ob)},'Synthetic Tenant B');
    insert into public.invites(org_id,email,role,expires_at) values
      (${q(ids.oa)},${q(emails.a)},'admin',clock_timestamp()+interval '1 hour'),
      (${q(ids.ob)},${q(emails.b)},'admin',clock_timestamp()+interval '1 hour'),
      (${q(ids.oa)},${q(emails.both)},'admin',clock_timestamp()+interval '1 hour'),
      (${q(ids.ob)},${q(emails.both)},'admin',clock_timestamp()+interval '1 hour');`);
  const sessions = { a: await signup(emails.a), b: await signup(emails.b), both: await signup(emails.both) };
  await sql(`
    insert into public.deals(id,org_id,dedupe_key,address,state,zip,status,units_count) values
      (${q(ids.da)},${q(ids.oa)},'local-rent-a','A ONLY RENT ADDRESS','AZ','85001','analyzing',4),
      (${q(ids.db)},${q(ids.ob)},'local-rent-b','B ONLY RENT ADDRESS','AZ','85002','analyzing',4);
    insert into public.units(deal_id,org_id,type,count,sqft,actual_rent,market_rent) values
      (${q(ids.da)},${q(ids.oa)},'2BR',4,850,1500,1500),
      (${q(ids.db)},${q(ids.ob)},'2BR',4,850,1600,1600);
    insert into public.rent_bands(org_id,source,zip,period,bedrooms,rent) values
      (${q(ids.oa)},'zori','85001','2026-10',-1,1500),
      (${q(ids.ob)},'zori','85002','2026-10',-1,1600);`);

  process.env.VITE_SUPABASE_URL = localBase;
  process.env.VITE_SUPABASE_ANON_KEY = anonKey;
  server = await createServer({
    root: appRoot, configFile: path.join(appRoot, 'vite.config.js'), cacheDir: path.join(temp, 'vite-cache'), envDir: temp,
    server: { host: '127.0.0.1', port: 0, strictPort: true, open: false, fs: { allow: [path.dirname(appRoot), appRoot] } },
  });
  await server.listen();
  const appBase = `http://127.0.0.1:${server.httpServer.address().port}`;
  browser = await chromium.launch({ ...(process.env.MFDA_TEST_BROWSER ? { executablePath: process.env.MFDA_TEST_BROWSER } : {}), headless: true });

  async function fixture(t, session = sessions.both, org = ids.oa) {
    await sql(`delete from public.rent_estimates where org_id in (${q(ids.oa)},${q(ids.ob)}); delete from public.cost_ledger where org_id in (${q(ids.oa)},${q(ids.ob)});`);
    const ctx = await browser.newContext();
    t.after(() => ctx.close());
    const requests = [], upstream = [], barriers = new Map();
    let rent = 9876;
    function hold(stage) {
      const started = deferred(), released = deferred();
      barriers.set(stage, { started, released });
      return { started: started.promise, release: released.resolve };
    }
    async function pause(stage) {
      const barrier = barriers.get(stage);
      if (!barrier) return;
      barriers.delete(stage);
      barrier.started.resolve();
      await barrier.released.promise;
    }
    await ctx.route(`${localBase}/rest/v1/*`, async route => {
      const req = route.request(), url = new URL(req.url()), table = url.pathname.split('/').at(-1);
      requests.push({ table, method: req.method(), search: url.search, body: req.postDataJSON?.() });
      if (table === 'rent_estimates' && ['GET', 'HEAD'].includes(req.method())) await pause('cache');
      if (table === 'cost_ledger' && ['GET', 'HEAD'].includes(req.method())) await pause('usage');
      await route.continue();
    });
    await ctx.route('**/.netlify/functions/rent-estimate?*', async route => {
      const req = route.request();
      requests.push({ table: 'proxy', method: req.method(), url: req.url() });
      const nativeFetch = globalThis.fetch;
      const prior = { url: process.env.SUPABASE_URL, key: process.env.SUPABASE_ANON_KEY, rentcast: process.env.RENTCAST_API_KEY };
      process.env.SUPABASE_URL = localBase;
      process.env.SUPABASE_ANON_KEY = anonKey;
      process.env.RENTCAST_API_KEY = 'LOCAL-SYNTHETIC-STUB-ONLY';
      globalThis.fetch = async (input, init) => {
        const url = new URL(input);
        if (url.hostname === 'api.rentcast.io') {
          upstream.push({ address: url.searchParams.get('address') });
          await pause('proxy');
          return Response.json({ rent, rentRangeLow: rent - 100, rentRangeHigh: rent + 100, comparables: [{}] });
        }
        return nativeFetch(input, init);
      };
      try {
        const response = await handler(new Request(req.url(), { headers: { Authorization: req.headers().authorization } }));
        await route.fulfill({ status: response.status, headers: Object.fromEntries(response.headers), body: await response.text() });
      } finally {
        globalThis.fetch = nativeFetch;
        for (const [key, value] of [['SUPABASE_URL', prior.url], ['SUPABASE_ANON_KEY', prior.key], ['RENTCAST_API_KEY', prior.rentcast]]) {
          if (value === undefined) delete process.env[key]; else process.env[key] = value;
        }
      }
    });
    await ctx.routeWebSocket(/127\.0\.0\.1:55421\/realtime/, socket => socket.close());
    await ctx.route('**/*', async route => {
      const url = new URL(route.request().url());
      if ([appBase, localBase].includes(url.origin)) return route.fallback();
      return route.abort();
    });
    const page = await ctx.newPage();
    page.setDefaultTimeout(20000);
    const pageErrors = [];
    page.on('pageerror', error => pageErrors.push(error.message));
    await page.goto(appBase + '/signin');
    await page.evaluate(async ({ session: s, orgId }) => {
      localStorage.setItem(`mfda.activeOrg:${s.user.id}`, orgId);
      const { supabase } = await import('/src/lib/supabase.js');
      const { error } = await supabase.auth.setSession({ access_token: s.access_token, refresh_token: s.refresh_token });
      if (error) throw error;
    }, { session, orgId: org });
    if (session.user.id === sessions.both.user.id) {
      await page.locator('header select').waitFor();
      if (await page.locator('header select').inputValue() !== org) await page.locator('header select').selectOption(org);
      await page.waitForFunction(orgId => document.querySelector('header select')?.value === orgId, org);
    } else {
      await page.getByText(org === ids.oa ? 'Synthetic Tenant A' : 'Synthetic Tenant B', { exact: true }).waitFor();
    }
    async function ready(deal = org === ids.oa ? ids.da : ids.db) {
      await page.goto(appBase + `/deals/${deal}/edit`);
      try {
        await page.getByRole('button', { name: /Address-level/ }).waitFor();
      } catch (error) {
        error.message += `\nURL=${page.url()}\nBODY=${(await page.locator('body').innerText()).slice(0, 1500)}\nPAGE_ERRORS=${pageErrors.join(' | ')}`;
        throw error;
      }
      await page.getByText(/0\/50 used this month/).waitFor();
    }
    await ready();
    async function start() {
      const button = page.getByRole('button', { name: /Address-level/ });
      assert.equal(await button.isEnabled(), true);
      await button.evaluate(element => {
        const props = element[Object.keys(element).find(key => key.startsWith('__reactProps$'))];
        window.localRentAction = props.onClick();
      });
    }
    async function settle() {
      await page.evaluate(() => window.localRentAction);
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    }
    async function switchOrg(next) {
      await page.locator('header select').selectOption(next);
      await page.waitForFunction(value => document.querySelector('header select')?.value === value, next);
    }
    async function assertNoAArtifactsUnderB() {
      await settle();
      assert.doesNotMatch(await page.locator('body').innerText(), /9,876|A ONLY RENT ADDRESS/);
      assert.equal(await sql(`select count(*) from public.rent_estimates where org_id=${q(ids.oa)}`), '0');
      assert.equal(await sql(`select count(*) from public.cost_ledger where org_id=${q(ids.oa)}`), '0');
    }
    return { page, requests, upstream, hold, ready, start, settle, switchOrg, assertNoAArtifactsUnderB, setRent: value => { rent = value; } };
  }

  await t.test('A remains A and succeeds through real Auth/RLS with only RentCast stubbed', async t => {
    const f = await fixture(t); await f.start(); await f.settle();
    assert.match(await f.page.locator('body').innerText(), /9,876/);
    assert.equal(f.upstream.length, 1);
    assert.equal(await sql(`select rent from public.rent_estimates where org_id=${q(ids.oa)}`), '9876');
    assert.equal(await sql(`select count(*) from public.cost_ledger where org_id=${q(ids.oa)}`), '1');
  });
  for (const stage of ['cache', 'usage']) {
    await t.test(`A ${stage} held then switch to B starts no obsolete proxy`, async t => {
      const f = await fixture(t), barrier = f.hold(stage);
      await f.start(); await barrier.started; await f.switchOrg(ids.ob); barrier.release(); await f.assertNoAArtifactsUnderB();
      assert.equal(f.requests.filter(r => r.table === 'proxy').length, 0);
      assert.equal(f.upstream.length, 0);
    });
  }
  await t.test('session lookup held then switch to B starts no stale call', async t => {
    const f = await fixture(t);
    await f.page.evaluate(async () => {
      const { supabase } = await import('/src/lib/supabase.js');
      const original = supabase.auth.getSession.bind(supabase.auth);
      window.localSessionGate = new Promise(resolve => { window.releaseLocalSession = resolve; });
      supabase.auth.getSession = async (...args) => {
        const result = await original(...args);
        if (new Error().stack.includes('fetchRentEstimate')) { window.localSessionStarted = true; await window.localSessionGate; }
        return result;
      };
    });
    await f.start(); await f.page.waitForFunction(() => window.localSessionStarted); await f.switchOrg(ids.ob);
    await f.page.evaluate(() => window.releaseLocalSession()); await f.assertNoAArtifactsUnderB();
    assert.equal(f.requests.filter(r => r.table === 'proxy').length, 0);
  });
  await t.test('proxy result held then switch to B suppresses result/cache/metering', async t => {
    const f = await fixture(t), barrier = f.hold('proxy');
    await f.start(); await barrier.started; await f.switchOrg(ids.ob); barrier.release(); await f.assertNoAArtifactsUnderB();
    assert.equal(f.upstream.length, 1);
  });
  await t.test('A to B to A never revives first A operation', async t => {
    const f = await fixture(t), barrier = f.hold('proxy');
    await f.start(); await barrier.started; await f.switchOrg(ids.ob); await f.switchOrg(ids.oa); barrier.release(); await f.settle();
    assert.doesNotMatch(await f.page.locator('body').innerText(), /9,876/);
    assert.equal(await sql(`select count(*) from public.rent_estimates where org_id=${q(ids.oa)}`), '0');
    f.setRent(1731); await f.start(); await f.settle();
    assert.match(await f.page.locator('body').innerText(), /1,731/);
  });
  await t.test('fresh B estimate works without A attribution', async t => {
    const f = await fixture(t), barrier = f.hold('cache');
    await f.start(); await barrier.started; await f.switchOrg(ids.ob); barrier.release(); await f.assertNoAArtifactsUnderB();
    await f.ready(ids.db); f.setRent(2832); await f.start(); await f.settle();
    assert.match(await f.page.locator('body').innerText(), /2,832/);
    assert.equal(await sql(`select count(*) from public.rent_estimates where org_id=${q(ids.ob)} and rent=2832`), '1');
    assert.equal(await sql(`select count(*) from public.rent_estimates where org_id=${q(ids.oa)}`), '0');
  });
  await t.test('revoked membership fails closed during the action', async t => {
    const f = await fixture(t, sessions.a), barrier = f.hold('cache');
    await f.start(); await barrier.started;
    await sql(`delete from public.org_members where org_id=${q(ids.oa)} and user_id=${q(sessions.a.user.id)}`);
    await f.page.evaluate(() => window.dispatchEvent(new Event('focus')));
    barrier.release(); await f.settle();
    assert.equal(f.requests.filter(r => r.table === 'proxy').length, 0);
    assert.equal(await sql(`select count(*) from public.rent_estimates where org_id=${q(ids.oa)}`), '0');
    await sql(`insert into public.org_members(org_id,user_id,role) values (${q(ids.oa)},${q(sessions.a.user.id)},'admin') on conflict do nothing`);
  });
  await t.test('logout during action suppresses stale continuation', async t => {
    const f = await fixture(t, sessions.a), barrier = f.hold('cache');
    await f.start(); await barrier.started; await f.page.getByRole('button', { name: 'Sign out' }).click();
    await f.page.getByRole('button', { name: 'Send magic link' }).waitFor(); barrier.release(); await f.settle();
    assert.equal(f.requests.filter(r => r.table === 'proxy').length, 0);
    assert.equal(await sql(`select count(*) from public.rent_estimates where org_id=${q(ids.oa)}`), '0');
  });
});
