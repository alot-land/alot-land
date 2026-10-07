import { test } from 'node:test';
import assert from 'node:assert/strict';
import handler from '../../../../mfda/netlify/functions/rent-estimate.mjs';
import { browserHarness } from '../../../../mfda/security/browser-harness.mjs';
import { database, ids, quote as q } from '../../../../mfda/security/db-harness.mjs';

const deferred = () => {
  let resolve;
  const promise = new Promise((r) => { resolve = r; });
  return { promise, resolve };
};

test('independent proxy revocation timing uses actual local membership RLS', { timeout: 120000 }, async (t) => {
  const db = await database();
  t.after(() => db.close());

  const names = ['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY', 'RENTCAST_API_KEY'];
  const prior = names.map((name) => [name, process.env[name]]);
  Object.assign(process.env, {
    SUPABASE_URL: 'https://independent-auth.invalid',
    SUPABASE_ANON_KEY: 'INDEPENDENT-PUBLIC-ANON',
    VITE_SUPABASE_URL: '',
    VITE_SUPABASE_ANON_KEY: '',
    RENTCAST_API_KEY: 'INDEPENDENT-RENTCAST-SECRET',
  });
  t.after(() => prior.forEach(([name, value]) => {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }));

  let mode = 'normal';
  let gate = null;
  let rentcastCalls = 0;
  let membershipQueries = 0;
  let requestedUser = null;
  t.mock.method(globalThis, 'fetch', async (input, init = {}) => {
    const url = new URL(input);
    if (url.hostname === 'api.rentcast.io') {
      rentcastCalls++;
      assert.equal(init.headers['X-Api-Key'], 'INDEPENDENT-RENTCAST-SECRET');
      assert.equal(init.headers.Authorization, undefined);
      return Response.json({ rent: 1888, rentRangeLow: 1700, rentRangeHigh: 2000 });
    }
    assert.equal(url.origin, 'https://independent-auth.invalid');
    assert.equal(init.headers.apikey, 'INDEPENDENT-PUBLIC-ANON');
    assert.equal(init.headers.Authorization, 'Bearer INDEPENDENT-A-TOKEN');
    if (url.pathname === '/auth/v1/user') {
      if (mode === 'hold-auth') {
        gate.started.resolve();
        await gate.release.promise;
      }
      return Response.json({ id: ids.a });
    }
    assert.equal(url.pathname, '/rest/v1/org_members');
    membershipQueries++;
    requestedUser = url.searchParams.get('user_id');
    let rows;
    if (mode === 'hold-before-membership-read') {
      gate.started.resolve();
      await gate.release.promise;
    }
    rows = JSON.parse(await db.sql(`select coalesce(jsonb_agg(jsonb_build_object('org_id',org_id,'user_id',user_id)),'[]')
      from public.org_members where org_id=${q(ids.oa)} and user_id=${q(ids.a)}`, ids.a));
    if (mode === 'hold-after-membership-read') {
      gate.started.resolve();
      await gate.release.promise;
    }
    return Response.json(rows);
  });

  const invoke = (extra = {}) => handler(new Request(
    'http://localhost/.netlify/functions/rent-estimate?' + new URLSearchParams({
      orgId: ids.oa,
      address: 'INDEPENDENT A ADDRESS',
      userId: ids.b,
      ...extra,
    }),
    { headers: { Authorization: 'Bearer INDEPENDENT-A-TOKEN' } },
  ));

  await t.test('revocation while Auth lookup is held denies before RentCast', async () => {
    mode = 'hold-auth';
    gate = { started: deferred(), release: deferred() };
    const pending = invoke();
    await gate.started.promise;
    await db.sql(`delete from public.org_members where org_id=${q(ids.oa)} and user_id=${q(ids.a)}`);
    gate.release.resolve();
    const response = await pending;
    assert.equal(response.status, 403);
    assert.equal(rentcastCalls, 0);
    assert.equal(requestedUser, 'eq.' + ids.a, 'caller userId must not override verified Auth identity');
    await db.sql(`insert into public.org_members(org_id,user_id,role) values (${q(ids.oa)},${q(ids.a)},'member')`);
  });

  await t.test('revocation before the held membership SQL read denies before RentCast', async () => {
    mode = 'hold-before-membership-read';
    gate = { started: deferred(), release: deferred() };
    const pending = invoke();
    await gate.started.promise;
    await db.sql(`delete from public.org_members where org_id=${q(ids.oa)} and user_id=${q(ids.a)}`);
    gate.release.resolve();
    const response = await pending;
    assert.equal(response.status, 403);
    assert.equal(rentcastCalls, 0);
    await db.sql(`insert into public.org_members(org_id,user_id,role) values (${q(ids.oa)},${q(ids.a)},'member')`);
  });

  await t.test('revocation after authorization read cannot retract already-authorized server work', async () => {
    mode = 'hold-after-membership-read';
    gate = { started: deferred(), release: deferred() };
    const pending = invoke();
    await gate.started.promise;
    await db.sql(`delete from public.org_members where org_id=${q(ids.oa)} and user_id=${q(ids.a)}`);
    gate.release.resolve();
    const response = await pending;
    assert.equal(response.status, 200);
    assert.equal(rentcastCalls, 1);
    assert.equal((await response.json()).rent, 1888);
  });

  assert.equal(membershipQueries, 3);
  console.log(JSON.stringify({
    independentProxy: {
      revokedDuringAuthLookupRentcastCalls: 0,
      revokedBeforeMembershipReadRentcastCalls: 0,
      revokedAfterCompletedAuthorizationReadRentcastCalls: 1,
      callerIdentityIgnored: requestedUser === 'eq.' + ids.a,
    },
  }));
});

test('independent client probe holds proxy response body across tenant transitions', { timeout: 180000 }, async (t) => {
  const db = await database();
  let harness;
  t.after(async () => {
    try { await harness?.close(); }
    finally { await db.close(); }
  });
  await db.sql(`update public.deals set zip='85001',state='AZ' where id=${q(ids.deal)};
    insert into public.rent_bands(org_id,source,zip,period,bedrooms,rent)
      values (${q(ids.oa)},'zori','85001','2026-10',-1,1500);`);
  harness = await browserHarness(db);

  async function fixture({ failure = false } = {}) {
    const { ctx, page } = await harness.context(ids.a);
    t.after(() => ctx.close());
    await page.goto(harness.base + `/deals/${ids.deal}/edit`);
    const button = page.getByRole('button', { name: /Address-level/ });
    await button.waitFor();
    await page.evaluate(({ fail }) => {
      const original = window.fetch.bind(window);
      let release;
      const held = new Promise((r) => { release = r; });
      window.independentReleaseBody = release;
      window.independentProxyCalls = [];
      window.independentBodyStarted = false;
      window.fetch = async (input, init) => {
        const value = typeof input === 'string' ? input : input.url;
        if (!value.startsWith('/.netlify/functions/rent-estimate?')) return original(input, init);
        window.independentProxyCalls.push({ value, authorization: init?.headers?.Authorization });
        return {
          ok: !fail,
          status: fail ? 502 : 200,
          json: async () => {
            window.independentBodyStarted = true;
            await held;
            return fail
              ? { error: 'upstream_error', message: 'INDEPENDENT STALE ERROR', rentcast_contacted: true }
              : { rent: 9876, source: 'rentcast', fetched_at: '2026-10-07T00:00:00Z', rentcast_contacted: true };
          },
        };
      };
    }, { fail: failure });
    await button.evaluate((element) => {
      window.independentRentAction = element[Object.keys(element).find((key) => key.startsWith('__reactProps$'))].onClick();
    });
    await page.waitForFunction(() => window.independentBodyStarted);
    return { ctx, page };
  }

  async function settle(page) {
    await page.evaluate(() => window.independentRentAction);
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  }

  await t.test('late successful body under B publishes no result, cache, usage, error, or busy state', async () => {
    const f = await fixture();
    const requestsBefore = harness.requests.length;
    await harness.changeUser(f.page, ids.b);
    await f.page.getByText('Synthetic Tenant B', { exact: true }).waitFor();
    await f.page.evaluate(() => window.independentReleaseBody());
    await settle(f.page);
    const body = await f.page.locator('body').innerText();
    assert.doesNotMatch(body, /9,876|INDEPENDENT STALE ERROR|Fetching/);
    assert.equal(await db.sql('select count(*) from public.rent_estimates'), '0');
    assert.equal(await db.sql('select count(*) from public.cost_ledger'), '0');
    assert.equal(harness.requests.slice(requestsBefore).filter((request) =>
      request.method === 'POST' && ['rent_estimates', 'cost_ledger'].includes(request.table)).length, 0);
  });

  await t.test('late error body under B is suppressed', async () => {
    const f = await fixture({ failure: true });
    await harness.changeUser(f.page, ids.b);
    await f.page.getByText('Synthetic Tenant B', { exact: true }).waitFor();
    await f.page.evaluate(() => window.independentReleaseBody());
    await settle(f.page);
    assert.doesNotMatch(await f.page.locator('body').innerText(), /INDEPENDENT STALE ERROR|Fetching/);
    assert.equal(await db.sql('select count(*) from public.cost_ledger'), '0');
  });

  await t.test('A to B to A does not revive the first response body or busy state', async () => {
    const f = await fixture();
    await harness.changeUser(f.page, ids.b);
    await f.page.getByText('Synthetic Tenant B', { exact: true }).waitFor();
    await harness.changeUser(f.page, ids.a);
    await f.page.getByText('Synthetic Tenant A', { exact: true }).waitFor();
    await f.page.getByRole('button', { name: /Address-level/ }).waitFor();
    await f.page.evaluate(() => window.independentReleaseBody());
    await settle(f.page);
    const body = await f.page.locator('body').innerText();
    assert.doesNotMatch(body, /9,876|INDEPENDENT STALE ERROR|Fetching/);
    assert.equal(await f.page.getByRole('button', { name: /Address-level/ }).isEnabled(), true);
  });

  assert.deepEqual(harness.errors, []);
});
