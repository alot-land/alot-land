import { test } from 'node:test';
import assert from 'node:assert/strict';
import { database, ids, quote as q } from './db-harness.mjs';
import { browserHarness } from './browser-harness.mjs';

const screens = [
  ['/deals', 'A ONLY SECURITY CANARY'],
  [`/deals/${ids.deal}`, 'A ONLY NOTE CANARY'],
  [`/deals/${ids.deal}/compare`, 'A ONLY ANALYSIS CANARY'],
  [`/deals/${ids.deal}/edit`, 'A ONLY SECURITY CANARY'],
  ['/on-market', 'A ONLY LISTING CANARY'],
  ['/off-market', 'A ONLY PARCEL CANARY'],
  [`/off-market/${ids.parcel}`, 'A ONLY PARCEL CANARY'],
  ['/goals', 'A ONLY GOAL CANARY'],
  ['/settings', 'A ONLY MARKET CANARY'],
  ['/markets', 'A ONLY MARKET STATS CANARY'],
];
async function absent(page) {
  const data = await page.evaluate(() => document.body.innerText + '\n' + [...document.querySelectorAll('input,textarea')].map((e) => e.value).join('\n'));
  assert.doesNotMatch(data, /A ONLY /, 'foreign tenant data must never render');
}
async function watch(page) {
  await page.evaluate((orgB) => {
    window.securityLeaks = [];
    const check = () => {
      const header = document.querySelector('header');
      const selector = header?.querySelector('select');
      const underB = selector ? selector.value === orgB : header?.innerText.includes('Synthetic Tenant B');
      const content = document.body.innerText + [...document.querySelectorAll('input,textarea')].map((e) => e.value).join('\n');
      if (underB && /A ONLY /.test(content)) window.securityLeaks.push(content);
    };
    new MutationObserver(check).observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true });
    check();
  }, ids.ob);
}
async function noLeaks(page) { assert.deepEqual(await page.evaluate(() => window.securityLeaks), []); }
async function loaded(page, marker) {
  await page.waitForFunction((s) => document.body.innerText.includes(s) || [...document.querySelectorAll('input')].some((e) => e.value.includes(s)), marker);
}
async function waitForRequest(page, predicate) {
  const deadline = Date.now() + 15000;
  while (!predicate()) {
    assert.ok(Date.now() < deadline, 'expected synthetic request did not start');
    await page.waitForTimeout(20);
  }
}

test('tenant isolation in the actual MFDA SPA with PostgreSQL-backed synthetic API', async (t) => {
  const db = await database();
  let h;
  t.after(async () => { try { await h?.close(); } finally { await db.close(); } });
  h = await browserHarness(db);
  for (const [pathname, marker] of screens) {
    await t.test(`A logout → B; cached ${pathname} unavailable throughout delay/error/retry`, async () => {
      const { ctx, page } = await h.context();
      try {
        await page.goto(h.base + pathname); await loaded(page, marker); await watch(page);
        await page.getByRole('button', { name: 'Sign out', exact: true }).click();
        await page.waitForURL('**/signin');
        h.control.delay = 150;
        await h.changeUser(page, ids.b);
        await page.getByText('Synthetic Tenant B', { exact: true }).waitFor();
        await h.route(page, pathname);
        await absent(page);
        await page.waitForTimeout(500);
        await absent(page); await noLeaks(page);
        assert.equal(await db.sql(`select count(*) from public.deals where id=${q(ids.deal)}`, ids.b), '0');
        assert.equal(await db.sql(`select count(*) from public.parcels where id=${q(ids.parcel)}`, ids.b), '0');
      } finally { h.control.delay = 0; await ctx.close(); }
    });
  }
  await t.test('direct token replacement on an open deal clears A before B renders', async () => {
    const { ctx, page } = await h.context();
    try {
      await page.goto(h.base + `/deals/${ids.deal}`); await loaded(page, 'A ONLY SECURITY CANARY'); await watch(page);
      h.control.delay = 500;
      await h.changeUser(page, ids.b);
      await absent(page);
      await page.getByText('Synthetic Tenant B', { exact: true }).waitFor();
      await absent(page); await page.waitForTimeout(650); await noLeaks(page);
      assert.equal(await page.getByText('PDF', { exact: true }).count(), 0);
    } finally { h.control.delay = 0; await ctx.close(); }
  });
  await t.test('delayed failing logout hides A immediately and clears persisted session', async () => {
    const { ctx, page } = await h.context();
    try {
      await page.goto(h.base + `/deals/${ids.deal}`); await loaded(page, 'A ONLY SECURITY CANARY');
      h.control.logoutDelay = 600; h.control.logoutFail = true;
      const start = h.requests.length;
      await page.getByRole('button', { name: 'Sign out', exact: true }).click();
      await page.waitForURL('**/signin'); await absent(page);
      await page.waitForFunction(() => localStorage.getItem('sb-mfda-security-auth-token') === null);
      assert.ok(h.requests.slice(start).some((r) => r.table === 'logout'));
      await page.reload(); await page.waitForURL('**/signin'); await absent(page);
      await h.changeUser(page, ids.b);
      await page.getByText('Synthetic Tenant B', { exact: true }).waitFor(); await absent(page);
    } finally { h.control.logoutDelay = 0; h.control.logoutFail = false; await ctx.close(); }
  });
  await t.test('browser back/forward, route changes, refresh and persisted storage cannot restore A', async () => {
    const { ctx, page } = await h.context();
    try {
      await page.goto(h.base + `/deals/${ids.deal}`); await loaded(page, 'A ONLY SECURITY CANARY');
      await h.route(page, `/deals/${ids.deal}/compare`); await loaded(page, 'A ONLY ANALYSIS CANARY');
      await watch(page); await h.changeUser(page, ids.b); await absent(page);
      await page.goBack(); await absent(page);
      await page.goForward(); await absent(page);
      for (const [pathname] of screens) { await h.route(page, pathname); await page.waitForTimeout(100); await absent(page); }
      await page.reload(); await page.getByText('Synthetic Tenant B', { exact: true }).waitFor(); await absent(page);
      const storage = await page.evaluate(async () => ({ local: Object.entries(localStorage), session: Object.entries(sessionStorage), caches: await caches.keys(), databases: await indexedDB.databases(), workers: (await navigator.serviceWorker.getRegistrations()).length }));
      assert.doesNotMatch(JSON.stringify(storage), /A ONLY /);
      assert.deepEqual(storage.session, []); assert.deepEqual(storage.caches, []); assert.deepEqual(storage.databases, []); assert.equal(storage.workers, 0);
      assert.equal(await db.sql(`select count(*) from public.scenarios where deal_id=${q(ids.deal)}`, ids.b), '0');
    } finally { await ctx.close(); }
  });
  await t.test('A → B → A → B organization switches reauthorize known IDs and reset forms', async () => {
    const { ctx, page } = await h.context(ids.both);
    try {
      await page.goto(h.base + `/deals/${ids.deal}/edit`); await loaded(page, 'A ONLY SECURITY CANARY'); await watch(page);
      for (let i = 0; i < 2; i++) {
        await page.locator('header select').selectOption(ids.ob);
        await absent(page);
        await page.waitForTimeout(250); await absent(page); await noLeaks(page);
        if (i === 0) { await page.locator('header select').selectOption(ids.oa); await loaded(page, 'A ONLY SECURITY CANARY'); }
      }
      await h.route(page, `/deals/${ids.deal}`); await page.waitForTimeout(200); await absent(page);
      // Multi-org user can read A in SQL, but active-org B reads must be scoped.
      assert.equal(await db.sql(`select count(*) from public.deals where id=${q(ids.deal)}`, ids.both), '1');
      const reads = h.requests.filter((r) => r.uid === ids.both && r.table === 'deals' && r.search.includes(ids.deal));
      assert.ok(reads.some((r) => r.search.includes('org_id=eq.' + ids.ob)));
    } finally { await ctx.close(); }
  });
  for (const [pathname, marker] of screens.filter(([p]) => !p.endsWith('/edit'))) {
    await t.test(`active-org A → B scopes shared screen ${pathname} for multi-org user`, async () => {
      const { ctx, page } = await h.context(ids.both);
      try {
        await page.goto(h.base + pathname); await loaded(page, marker); await watch(page);
        await page.locator('header select').selectOption(ids.ob);
        await absent(page);
        await page.waitForFunction((id) => document.querySelector('header select')?.value === id, ids.ob);
        await page.waitForTimeout(250); await absent(page); await noLeaks(page);
      } finally { await ctx.close(); }
    });
  }
  await t.test('repeated authenticated A → B → A → B replacements stay isolated', async () => {
    const { ctx, page } = await h.context();
    try {
      await page.goto(h.base + `/deals/${ids.deal}`); await loaded(page, 'A ONLY SECURITY CANARY'); await watch(page);
      for (const uid of [ids.b, ids.a, ids.b]) {
        await h.changeUser(page, uid);
        if (uid === ids.a) await loaded(page, 'A ONLY SECURITY CANARY');
        else {
          await absent(page);
          await page.getByText('Synthetic Tenant B', { exact: true }).waitFor();
          await page.waitForTimeout(200); await absent(page); await noLeaks(page);
        }
      }
    } finally { await ctx.close(); }
  });
  await t.test('same-identity token renewal preserves an unsaved form', async () => {
    const { ctx, page } = await h.context();
    try {
      await page.goto(h.base + `/deals/${ids.deal}/edit`); await loaded(page, 'A ONLY SECURITY CANARY');
      // Find the actual address field rather than relying on layout order.
      const input = page.locator('input');
      const index = await input.evaluateAll((nodes) => nodes.findIndex((e) => e.value === 'A ONLY SECURITY CANARY'));
      assert.ok(index >= 0);
      await input.nth(index).fill('A ONLY UNSAVED FORM CANARY');
      await h.changeUser(page, ids.a, 1);
      await page.waitForTimeout(250);
      assert.equal(await input.nth(index).inputValue(), 'A ONLY UNSAVED FORM CANARY');
      await h.changeUser(page, ids.b); await absent(page);
    } finally { await ctx.close(); }
  });
  await t.test('unchanged background membership polling preserves an unsaved form', async () => {
    const { ctx, page } = await h.context();
    try {
      await page.clock.install();
      await page.goto(h.base + `/deals/${ids.deal}/edit`); await loaded(page, 'A ONLY SECURITY CANARY');
      const input = page.locator('input');
      const index = await input.evaluateAll((nodes) => nodes.findIndex((e) => e.value === 'A ONLY SECURITY CANARY'));
      assert.ok(index >= 0);
      await input.nth(index).fill('A ONLY UNSAVED POLL CANARY');
      const start = h.requests.length;
      await page.clock.fastForward(30001);
      await page.waitForFunction(() => document.querySelector('header')?.innerText.includes('Synthetic Tenant A'));
      await page.waitForTimeout(250);
      assert.ok(h.requests.slice(start).some((r) => r.table === 'org_members'));
      assert.equal(await input.nth(index).inputValue(), 'A ONLY UNSAVED POLL CANARY');
    } finally { await ctx.close(); }
  });
  await t.test('fresh B session rejects persisted A organization IDs', async () => {
    const { ctx, page } = await h.context(ids.b);
    try {
      await page.goto(h.base + `/deals/${ids.deal}`);
      await page.getByText('Synthetic Tenant B', { exact: true }).waitFor();
      await page.waitForTimeout(200); await absent(page);
      await page.reload();
      await page.getByText('Synthetic Tenant B', { exact: true }).waitFor(); await absent(page);
    } finally { await ctx.close(); }
  });
  await t.test('membership removal hides cached data before revalidation completes', async () => {
    const { ctx, page } = await h.context();
    try {
      await page.goto(h.base + `/deals/${ids.deal}`); await loaded(page, 'A ONLY SECURITY CANARY');
      await db.sql(`delete from public.org_members where user_id=${q(ids.a)}`);
      h.control.membershipDelay = 500;
      await page.evaluate(() => dispatchEvent(new Event('focus')));
      await absent(page);
      await page.getByText('No organization access.', { exact: false }).waitFor(); await absent(page);
      assert.equal(await db.sql('select count(*) from public.deals', ids.a), '0');
    } finally {
      h.control.membershipDelay = 0;
      await db.sql(`insert into public.org_members(org_id,user_id,role) values (${q(ids.oa)},${q(ids.a)},'member') on conflict do nothing`);
      await ctx.close();
    }
  });
  await t.test('role downgrade clears privileged invite cache and corrects own role', async () => {
    await db.sql(`insert into public.invites(org_id,email) values (${q(ids.oa)},'admin-secret@example.invalid')`);
    const { ctx, page } = await h.context(ids.both);
    try {
      await page.goto(h.base + '/settings'); await loaded(page, 'admin-secret@example.invalid');
      await db.sql(`update public.org_members set role='member' where user_id=${q(ids.both)} and org_id=${q(ids.oa)}`);
      h.control.membershipDelay = 500;
      await page.evaluate(() => dispatchEvent(new Event('focus')));
      assert.doesNotMatch(await page.locator('body').innerText(), /admin-secret/);
      await page.waitForFunction((id) => document.querySelector('header select')?.value === id, ids.oa);
      assert.equal(await page.locator('header').getByText('admin', { exact: true }).count(), 0);
      assert.doesNotMatch(await page.locator('body').innerText(), /admin-secret/);
      assert.equal(await db.sql('select count(*) from public.invites', ids.both), '0');
    } finally {
      h.control.membershipDelay = 0;
      await db.sql(`update public.org_members set role='admin' where user_id=${q(ids.both)} and org_id=${q(ids.oa)}`);
      await ctx.close();
    }
  });
  await t.test('delayed A query completion cannot populate B cache or component state', async () => {
    const { ctx, page } = await h.context();
    let release;
    try {
      await page.goto(h.base + '/deals'); await loaded(page, 'A ONLY SECURITY CANARY'); await watch(page);
      h.control.hold = new Promise((r) => { release = r; });
      const start = h.requests.length;
      await h.route(page, `/deals/${ids.deal}/edit`);
      await waitForRequest(page, () => h.requests.slice(start).some((r) => r.table === 'units'));
      await h.changeUser(page, ids.b); await absent(page);
      h.control.hold = null; release();
      await page.getByText('Synthetic Tenant B', { exact: true }).waitFor();
      await page.waitForTimeout(350); await absent(page); await noLeaks(page);
    } finally { h.control.hold = null; release?.(); await ctx.close(); }
  });
  await t.test('failed requests and retries cannot revive A cached responses', async () => {
    const { ctx, page } = await h.context();
    try {
      await page.goto(h.base + `/deals/${ids.deal}`); await loaded(page, 'A ONLY SECURITY CANARY'); await watch(page);
      h.control.fail = true;
      const start = h.requests.length;
      await h.changeUser(page, ids.b); await absent(page);
      await page.waitForTimeout(1600); await absent(page); await noLeaks(page);
      const retries = h.requests.slice(start).filter((r) => r.table === 'deals');
      assert.ok(retries.length >= 2, 'a failed B request must actually retry');
      assert.ok(retries.every((r) => r.uid === ids.b && r.search.includes('org_id=eq.' + ids.ob)));
    } finally { h.control.fail = false; await ctx.close(); }
  });
  await t.test('session expiration hides private state without a successful remote logout', async () => {
    const { ctx, page } = await h.context();
    try {
      await page.goto(h.base + `/deals/${ids.deal}`); await loaded(page, 'A ONLY SECURITY CANARY');
      h.control.logoutFail = true;
      // Publish through the real SDK with a short-lived synthetic token.
      await page.evaluate(async (id) => {
        const { supabase } = await import('/src/lib/supabase.js');
        const enc = (x) => btoa(JSON.stringify(x)).replaceAll('=','');
        const token = enc({alg:'HS256',typ:'JWT'})+'.'+enc({sub:id,exp:Math.floor(Date.now()/1000)+2,role:'authenticated'})+'.U1lOVEhFVElD';
        await supabase.auth.setSession({access_token:token,refresh_token:'SYNTHETIC'});
        supabase.auth.stopAutoRefresh();
      }, ids.a);
      await page.waitForURL('**/signin', { timeout: 6000 }); await absent(page);
      await page.waitForFunction(() => localStorage.getItem('sb-mfda-security-auth-token') === null);
    } finally { h.control.logoutFail = false; await ctx.close(); }
  });
  await t.test('query keys contain user, organization and role; identity replacement creates fresh cache', async () => {
    const { ctx, page } = await h.context();
    try {
      await page.goto(h.base + `/deals/${ids.deal}`); await loaded(page, 'A ONLY SECURITY CANARY');
      const keys = await page.evaluate(() => {
        const element = document.getElementById('root');
        const fiber = element[Object.keys(element).find((k) => k.startsWith('__reactContainer$'))].stateNode.current;
        const clients = new Set();
        function walk(f) { if (!f) return; const client = f.memoizedProps?.client; if (client?.getQueryCache) clients.add(client); walk(f.child); walk(f.sibling); }
        walk(fiber);
        return [...clients].flatMap((c) => c.getQueryCache().getAll().map((x) => x.queryKey));
      });
      assert.ok(keys.length > 0);
      for (const key of keys) { assert.equal(key[0], 'tenant'); assert.equal(key[1], ids.a); assert.equal(key[3], ids.oa); assert.equal(key[4], 'member'); }
      await watch(page); await h.changeUser(page, ids.b); await absent(page); await noLeaks(page);
      assert.ok(h.requests.filter((r) => r.table === 'org_members' && new URLSearchParams(r.search).get('select')?.includes('org:orgs')).every((r) => r.search.includes('user_id=eq.' + r.uid)));
    } finally { await ctx.close(); }
  });
  await t.test('cross-tab signout and login propagate identity isolation', async () => {
    const { ctx, page } = await h.context();
    const second = await ctx.newPage(); second.setDefaultTimeout(15000);
    try {
      await page.goto(h.base + `/deals/${ids.deal}`); await loaded(page, 'A ONLY SECURITY CANARY');
      await second.goto(h.base + `/deals/${ids.deal}`); await loaded(second, 'A ONLY SECURITY CANARY'); await watch(second);
      await page.getByRole('button', { name: 'Sign out', exact: true }).click();
      await second.waitForURL('**/signin'); await absent(second);
      await h.changeUser(page, ids.b);
      await second.getByText('Synthetic Tenant B', { exact: true }).waitFor();
      await h.route(second, `/deals/${ids.deal}`); await absent(second); await noLeaks(second);
    } finally { await ctx.close(); }
  });
  await t.test('late A membership response cannot restore A organization under B', async () => {
    const { ctx, page } = await h.context();
    try {
      await page.goto(h.base + `/deals/${ids.deal}`); await loaded(page, 'A ONLY SECURITY CANARY'); await watch(page);
      h.control.membershipDelay = 600;
      const start = h.requests.length;
      await page.evaluate(() => dispatchEvent(new Event('focus')));
      await waitForRequest(page, () => h.requests.slice(start).some((r) => r.table === 'org_members'));
      await h.changeUser(page, ids.b); await absent(page);
      await page.getByText('Synthetic Tenant B', { exact: true }).waitFor();
      await page.waitForTimeout(700); await absent(page); await noLeaks(page);
      assert.doesNotMatch(await page.locator('header').innerText(), /Synthetic Tenant A/);
    } finally { h.control.membershipDelay = 0; await ctx.close(); }
  });
  await t.test('polling detects removal when realtime and focus events are absent', async () => {
    const { ctx, page } = await h.context();
    try {
      await page.clock.install();
      await page.goto(h.base + `/deals/${ids.deal}`); await loaded(page, 'A ONLY SECURITY CANARY');
      await db.sql(`delete from public.org_members where user_id=${q(ids.a)}`);
      await page.clock.fastForward(30001);
      await page.getByText('No organization access.', { exact: false }).waitFor(); await absent(page);
    } finally {
      await db.sql(`insert into public.org_members(org_id,user_id,role) values (${q(ids.oa)},${q(ids.a)},'member') on conflict do nothing`);
      await ctx.close();
    }
  });
  await t.test('background polling clears admin-only data on role downgrade', async () => {
    const { ctx, page } = await h.context(ids.both);
    try {
      await page.clock.install();
      await page.goto(h.base + '/settings'); await loaded(page, 'admin-secret@example.invalid');
      await db.sql(`update public.org_members set role='member' where user_id=${q(ids.both)} and org_id=${q(ids.oa)}`);
      await page.clock.fastForward(30001);
      await page.waitForFunction(() => !document.body.innerText.includes('admin-secret@example.invalid'));
      assert.equal(await page.locator('header').getByText('admin', { exact: true }).count(), 0);
      assert.equal(await db.sql('select count(*) from public.invites', ids.both), '0');
    } finally {
      await db.sql(`update public.org_members set role='admin' where user_id=${q(ids.both)} and org_id=${q(ids.oa)}`);
      await ctx.close();
    }
  });
  assert.deepEqual(h.errors, [], 'frontend runtime and database adapter errors must fail the suite');
});
