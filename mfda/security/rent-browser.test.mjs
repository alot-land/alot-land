import { test } from 'node:test';
import assert from 'node:assert/strict';
import { database, ids, quote as q } from './db-harness.mjs';
import { browserHarness } from './browser-harness.mjs';

const bDeal = '30000000-0000-0000-0000-000000000002';
const deferred = () => { let resolve; const promise = new Promise(r => resolve = r); return { promise, resolve }; };
function clientsInPage() {
  const root = document.getElementById('root');
  const fiber = root[Object.keys(root).find(k => k.startsWith('__reactContainer$'))].stateNode.current;
  const clients = new Set();
  function walk(f) { if (!f) return; if (f.memoizedProps?.client?.getQueryCache) clients.add(f.memoizedProps.client); walk(f.child); walk(f.sibling); }
  walk(fiber); return [...clients];
}

test('real RentEstimator binds every asynchronous continuation to its initiating tenant lifetime', async t => {
  const db = await database(); let h;
  t.after(async () => { try { await h?.close(); } finally { await db.close(); } });
  // Round 1 no longer invents AZ or a four-unit 2BR mix. Supply the known
  // facts this authorization fixture requires; all P0 assertions are unchanged.
  await db.sql(`update public.deals set zip='85001',state='AZ' where id=${q(ids.deal)};
    insert into public.deals(id,org_id,dedupe_key,address,state,zip,status,units_count) values
      (${q(bDeal)},${q(ids.ob)},'b-rent','B ONLY RENT ADDRESS','AZ','85002','analyzing',4);
    insert into public.units(org_id,deal_id,type,count,sqft,actual_rent,market_rent) values
      (${q(ids.ob)},${q(bDeal)},'2BR/1BA',4,null,null,null);
    insert into public.rent_bands(org_id,source,zip,period,bedrooms,rent) values
      (${q(ids.oa)},'zori','85001','2026-10',-1,1500),(${q(ids.ob)},'zori','85002','2026-10',-1,1600);`);
  h = await browserHarness(db);

  async function fixture(t, user = ids.a) {
    await db.sql('delete from public.rent_estimates; delete from public.cost_ledger;');
    const { ctx, page } = await h.context(user);
    const writes = [], outbound = [], reads = [], barriers = new Map();
    const control = { cacheError: false, proxyError: false, proxyStatus: 200, contacted: true, count: 0, rent: 9876 };
    function hold(stage) { const started = deferred(), released = deferred(); const entry = { started, released }; barriers.set(stage, entry); return { started: started.promise, release: () => released.resolve() }; }
    async function pause(stage) { const entry = barriers.get(stage); if (entry) { barriers.delete(stage); entry.started.resolve(); await entry.released.promise; } }
    const heldEntries = [];
    const holdStage = stage => { const barrier = hold(stage); heldEntries.push(barrier); return barrier; };
    t.after(async () => { heldEntries.forEach(b => b.release()); await ctx.close(); });
    const uid = req => JSON.parse(Buffer.from(req.headers().authorization.split('.')[1], 'base64url')).sub;
    await ctx.route('https://mfda-security.invalid/rest/v1/*', async route => {
      const req = route.request(), url = new URL(req.url()), table = url.pathname.split('/').at(-1);
      if (!['rent_estimates', 'cost_ledger'].includes(table)) return route.fallback();
      const userId = uid(req);
      if (req.method() === 'POST') {
        const row = req.postDataJSON(); writes.push({ table, uid: userId, row });
        // Actual authenticated SQL/RLS, including positive cache and ledger writes.
        const columns = table === 'cost_ledger' ? ['org_id','created_by','kind','provider','description','amount_usd']
          : ['org_id','created_by','addr_key','address','bedrooms','rent','rent_low','rent_high','comp_count','source','fetched_at'];
        const values = columns.map(c => row[c] == null ? 'null' : q(row[c])).join(',');
        const conflict = table === 'rent_estimates' ? ' on conflict (org_id,addr_key,source,bedrooms) do update set rent=excluded.rent' : '';
        const body = await db.sql(`insert into public.${table}(${columns.join(',')}) values (${values})${conflict} returning to_jsonb(${table})`, userId);
        await pause(table === 'cost_ledger' ? 'log' : 'save');
        return route.fulfill({ status: 201, contentType: 'application/json', body: table === 'cost_ledger' ? 'null' : body }).catch(() => {});
      }
      const org = url.searchParams.get('org_id').slice(3);
      reads.push({ table, uid: userId, org });
      if (table === 'cost_ledger') {
        await pause('usage');
        return route.fulfill({ status: 200, headers: { 'content-range': `*/${control.count}`, 'content-type': 'application/json',
          'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-expose-headers': 'content-range' }, body: '' }).catch(() => {});
      }
      const key = url.searchParams.get('addr_key').slice(3), beds = url.searchParams.get('bedrooms').slice(3);
      const body = await db.sql(`select coalesce(jsonb_agg(to_jsonb(r)),'[]') from public.rent_estimates r
        where org_id=${q(org)} and addr_key=${q(key)} and bedrooms=${q(beds)}`, userId);
      await pause('cache');
      return route.fulfill({ status: control.cacheError ? 400 : 200, contentType: 'application/json',
        body: control.cacheError ? JSON.stringify({ message: 'A STALE RENT ERROR' }) : body }).catch(() => {});
    });
    await ctx.route('**/.netlify/functions/rent-estimate?*', async route => {
      const req = route.request(), url = new URL(req.url()), userId = uid(req), org = url.searchParams.get('orgId');
      assert.equal(await db.sql(`select count(*) from public.org_members where org_id=${q(org)} and user_id=${q(userId)}`, userId), '1');
      outbound.push({ uid: userId, org, address: url.searchParams.get('address') });
      await pause('proxy');
      const body = control.proxyError ? { error: 'synthetic_error', message: 'A STALE RENT ERROR', rentcast_contacted: control.contacted }
        : { rent: control.rent, source: 'rentcast', fetched_at: '2026-10-07T00:00:00Z', rentcast_contacted: true };
      return route.fulfill({ status: control.proxyError ? control.proxyStatus : 200, contentType: 'application/json', body: JSON.stringify(body) }).catch(() => {});
    });
    async function ready(deal = ids.deal) {
      await page.goto(h.base + `/deals/${deal}/edit`);
      await page.getByRole('button', { name: /Address-level/ }).waitFor();
      await page.waitForFunction(code => eval('(' + code + ')')().some(c => c.getQueryCache().getAll().some(q => q.queryKey.includes('rentcast-usage') && q.state.status === 'success')), clientsInPage.toString());
    }
    await ready();
    await page.evaluate(code => { window.oldRentClient = eval('(' + code + ')')()[0]; }, clientsInPage.toString());
    async function start() {
      const button = page.getByRole('button', { name: /Address-level/ });
      assert.equal(await button.isEnabled(), true);
      // Invoke the actual bound UI action and retain its promise so negatives
      // wait for complete settlement rather than a timing sleep or DOM guess.
      await button.evaluate(e => { window.rentAction = e[Object.keys(e).find(k => k.startsWith('__reactProps$'))].onClick(); });
    }
    async function settle() { await page.evaluate(() => window.rentAction); await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))); }
    async function switchScope(kind, next = 'B') {
      if (kind === 'user') await h.changeUser(page, next === 'B' ? ids.b : ids.a);
      else await page.locator('header select').selectOption(next === 'B' ? ids.ob : ids.oa);
      if (kind === 'user') await page.getByText('Synthetic Tenant ' + next, { exact: true }).waitFor();
      else await page.waitForFunction(org => document.querySelector('header select')?.value === org, next === 'B' ? ids.ob : ids.oa);
      if (next === 'A') await page.getByRole('button', { name: /Address-level/ }).waitFor();
    }
    async function noResult({ underB = true } = {}) {
      await settle();
      const state = await page.evaluate(code => ({ text: document.body.innerText, inputs: [...document.querySelectorAll('input')].map(e => e.value),
        caches: eval('(' + code + ')')().flatMap(c => c.getQueryCache().getAll().map(q => ({ key: q.queryKey, data: q.state.data }))),
        oldCount: window.oldRentClient.getQueryCache().getAll().length }), clientsInPage.toString());
      assert.doesNotMatch(state.text, /9,876|A STALE RENT ERROR/);
      assert.equal(state.oldCount, 0, 'obsolete query client remains disposed');
      if (underB) {
        assert.doesNotMatch(JSON.stringify(state), /A ONLY/);
        assert.ok(state.caches.every(q => q.key[3] === ids.ob));
      }
    }
    return { page, start, settle, ready, switchScope, noResult, hold: holdStage, writes, outbound, reads, control };
  }

  await t.test('same-scope cache miss succeeds with initiating bearer/org and exact cache/usage attribution', async t => {
    const f = await fixture(t); await f.start(); await f.settle();
    assert.deepEqual(f.outbound, [{ uid: ids.a, org: ids.oa, address: 'A ONLY SECURITY CANARY, AZ, 85001' }]);
    assert.deepEqual(f.writes.map(w => w.table), ['cost_ledger','rent_estimates']);
    assert.ok(f.writes.every(w => w.uid === ids.a && w.row.org_id === ids.oa && w.row.created_by === ids.a));
    assert.equal(await db.sql(`select rent from public.rent_estimates where org_id=${q(ids.oa)}`), '9876');
    assert.match(await f.page.locator('body').innerText(), /9,876/);
  });
  await t.test('same-scope cache hit returns without upstream or metering', async t => {
    const f = await fixture(t); await f.start(); await f.settle();
    f.outbound.length = 0; f.writes.length = 0;
    await f.start(); await f.settle();
    assert.deepEqual(f.outbound, []); assert.deepEqual(f.writes, []);
    assert.match(await f.page.locator('body').innerText(), /cached/);
  });
  for (const kind of ['user', 'org']) {
    for (const stage of ['cache','usage','proxy']) {
      await t.test(`${kind} A → B during held ${stage} suppresses stale request/result/cache/meter`, async t => {
        const f = await fixture(t, kind === 'org' ? ids.both : ids.a); const barrier = f.hold(stage);
        await f.start(); await barrier.started;
        const usageAtHold = f.reads.filter(r => r.table === 'cost_ledger' && r.org === ids.oa).length;
        await f.switchScope(kind); barrier.release(); await f.noResult();
        assert.equal(f.outbound.length, stage === 'proxy' ? 1 : 0);
        assert.deepEqual(f.writes, []);
        if (stage === 'cache') assert.equal(f.reads.filter(r => r.table === 'cost_ledger' && r.org === ids.oa).length, usageAtHold, 'no obsolete usage follow-on after held cache miss');
        assert.equal(await db.sql('select count(*) from public.rent_estimates'), '0');
        assert.equal(await db.sql('select count(*) from public.cost_ledger'), '0');
      });
    }
    await t.test(`${kind} A → B suppresses late proxy error and usage`, async t => {
      const f = await fixture(t, kind === 'org' ? ids.both : ids.a); f.control.proxyError = true; f.control.proxyStatus = 502;
      const barrier = f.hold('proxy'); await f.start(); await barrier.started; await f.switchScope(kind); barrier.release(); await f.noResult();
      assert.equal(f.outbound.length, 1); assert.deepEqual(f.writes, []);
    });
    await t.test(`${kind} A → B → A never revives first-A result`, async t => {
      const f = await fixture(t, kind === 'org' ? ids.both : ids.a); const barrier = f.hold('proxy');
      await f.start(); await barrier.started; await f.switchScope(kind); await f.switchScope(kind, 'A');
      barrier.release(); await f.noResult({ underB: false }); assert.deepEqual(f.writes, []);
      f.control.rent = 1731; await f.start(); await f.settle(); assert.match(await f.page.locator('body').innerText(), /1,731/);
      assert.equal(f.outbound.length, 2); assert.equal(f.writes.length, 2);
    });
    await t.test(`${kind} B performs fresh estimate after suppressed A`, async t => {
      const f = await fixture(t, kind === 'org' ? ids.both : ids.a); const barrier = f.hold('cache');
      await f.start(); await barrier.started; await f.switchScope(kind); barrier.release(); await f.noResult();
      await f.ready(bDeal); f.control.rent = 2832; await f.start(); await f.settle();
      assert.equal(f.outbound.length, 1); assert.equal(f.outbound[0].org, ids.ob);
      assert.match(f.outbound[0].address, /B ONLY RENT ADDRESS/);
      assert.ok(f.writes.every(w => w.row.org_id === ids.ob && w.uid === (kind === 'org' ? ids.both : ids.b)));
      assert.match(await f.page.locator('body').innerText(), /2,832/);
    });
    await t.test(`${kind} switch during helper session lookup never sends obsolete bearer/address`, async t => {
      const f = await fixture(t, kind === 'org' ? ids.both : ids.a);
      await f.page.evaluate(async () => {
        const { supabase } = await import('/src/lib/supabase.js');
        const original = supabase.auth.getSession.bind(supabase.auth);
        window.rentSessionHold = new Promise(r => window.releaseRentSession = r);
        supabase.auth.getSession = async (...args) => {
          const inRentHelper = new Error().stack.includes('fetchRentEstimate');
          const result = await original(...args);
          if (inRentHelper) { window.rentSessionStarted = true; await window.rentSessionHold; }
          return result;
        };
      });
      await f.start(); await f.page.waitForFunction(() => window.rentSessionStarted);
      await f.switchScope(kind); await f.page.evaluate(() => window.releaseRentSession()); await f.noResult();
      assert.deepEqual(f.outbound, []); assert.deepEqual(f.writes, []);
    });
  }
  await t.test('held cache failure after user switch shows no stale error', async t => {
    const f = await fixture(t); f.control.cacheError = true; const barrier = f.hold('cache');
    await f.start(); await barrier.started; await f.switchScope('user'); barrier.release(); await f.noResult();
    assert.deepEqual(f.outbound, []); assert.deepEqual(f.writes, []);
  });
  await t.test('logout during cache miss suppresses every follow-on', async t => {
    const f = await fixture(t); const barrier = f.hold('cache'); await f.start(); await barrier.started;
    await f.page.getByRole('button', { name: 'Sign out' }).click(); await f.page.getByRole('button', { name: 'Send magic link' }).waitFor();
    barrier.release(); await f.settle(); assert.deepEqual(f.outbound, []); assert.deepEqual(f.writes, []);
  });
  await t.test('same-user token renewal preserves pending estimate', async t => {
    const f = await fixture(t); const barrier = f.hold('cache'); await f.start(); await barrier.started;
    await h.changeUser(f.page, ids.a, 1); barrier.release(); await f.settle();
    assert.equal(f.outbound.length, 1); assert.equal(f.writes.length, 2);
  });
  await t.test('scope change during an already initiated A usage write prevents cache/result follow-on', async t => {
    const f = await fixture(t); const barrier = f.hold('log'); await f.start(); await barrier.started;
    await f.switchScope('user'); barrier.release(); await f.noResult();
    assert.deepEqual(f.writes.map(w => w.table), ['cost_ledger']); assert.equal(f.writes[0].uid, ids.a);
    assert.equal(f.writes[0].row.org_id, ids.oa); assert.equal(await db.sql('select count(*) from public.rent_estimates'), '0');
  });
  await t.test('authorization rejection before RentCast creates no misleading meter', async t => {
    const f = await fixture(t); Object.assign(f.control, { proxyError: true, proxyStatus: 403, contacted: false });
    await f.start(); await f.settle(); assert.deepEqual(f.writes, []); assert.equal(f.outbound.length, 1);
  });
  await t.test('same-scope upstream failure is metered and shows current error', async t => {
    const f = await fixture(t); Object.assign(f.control, { proxyError: true, proxyStatus: 502 });
    await f.start(); await f.settle(); assert.deepEqual(f.writes.map(w => w.table), ['cost_ledger']);
    assert.match(await f.page.locator('body').innerText(), /A STALE RENT ERROR/);
  });
  await t.test('same-scope fresh quota denial updates current meter without upstream', async t => {
    const f = await fixture(t); f.control.count = 50; await f.start(); await f.settle();
    assert.deepEqual(f.outbound, []); assert.deepEqual(f.writes, []);
    assert.match(await f.page.locator('body').innerText(), /Stopped at the 50-request/);
  });
  assert.deepEqual(h.errors, []);
});
