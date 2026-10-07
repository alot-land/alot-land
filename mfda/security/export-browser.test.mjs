import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { database, ids, quote as q } from './db-harness.mjs';
import { browserHarness } from './browser-harness.mjs';

async function eventually(check) {
  const until = Date.now() + 15000;
  while (!(await check())) {
    assert.ok(Date.now() < until, 'expected export condition did not occur');
    await new Promise(r => setTimeout(r, 20));
  }
}
function clientsInPage() {
  const element = document.getElementById('root');
  const fiber = element[Object.keys(element).find(k => k.startsWith('__reactContainer$'))].stateNode.current;
  const clients = new Set();
  function walk(f) {
    if (!f) return;
    if (f.memoizedProps?.client?.getQueryCache) clients.add(f.memoizedProps.client);
    walk(f.child); walk(f.sibling);
  }
  walk(fiber); return [...clients];
}

test('tenant-scoped exports in the real SPA never release a stale completion', async t => {
  const db = await database(); let h;
  t.after(async () => { try { await h?.close(); } finally { await db.close(); } });
  h = await browserHarness(db);
  const bParcel = randomUUID();
  await db.sql(`insert into public.parcels(id,org_id,state,county_fips,apn,dedupe_key,situs_address,units)
    values (${q(bParcel)},${q(ids.ob)},'AZ','04013','B-EXPORT','b-export','B ONLY EXPORT PARCEL',4)`);
  const listA = await db.sql(`insert into public.mail_lists(org_id,name) values (${q(ids.oa)},'A ONLY DELAYED EXPORT') returning id`);
  const listB = await db.sql(`insert into public.mail_lists(org_id,name) values (${q(ids.ob)},'B ONLY NORMAL EXPORT') returning id`);
  await db.sql(`insert into public.mail_list_items(list_id,parcel_id,org_id) values
    (${q(listA)},${q(ids.parcel)},${q(ids.oa)}),(${q(listB)},${q(bParcel)},${q(ids.ob)})`);

  async function fixture(user = ids.a) {
    const { ctx, page } = await h.context(user);
    const requests = [], downloads = [], logs = [], pending = [];
    const control = { hold: false, fail: false, failuresRemaining: 0 };
    page.on('download', download => downloads.push(download));
    await ctx.addInitScript(() => {
      window.exportArtifacts = []; window.exportResponses = 0; window.exportLeaks = [];
      const NativeBlob = window.Blob;
      window.Blob = class extends NativeBlob {
        constructor(parts, options) {
          super(parts, options);
          if (options?.type?.includes('csv')) window.exportArtifacts.push({ kind: 'blob', text: String(parts[0]) });
        }
      };
      const create = URL.createObjectURL;
      URL.createObjectURL = function(blob) {
        const url = create.call(this, blob);
        window.exportArtifacts.push({ kind: 'url', type: blob.type, url }); return url;
      };
      const click = HTMLAnchorElement.prototype.click;
      HTMLAnchorElement.prototype.click = function() {
        if (this.download) window.exportArtifacts.push({ kind: 'download', name: this.download, url: this.href });
        return click.call(this);
      };
      const fetchOriginal = window.fetch;
      window.fetch = async (...args) => {
        const response = await fetchOriginal(...args);
        if (String(args[0]).includes('/mail_list_items')) {
          const text = response.text.bind(response);
          response.text = async () => { try { return await text(); } finally { window.exportResponses++; } };
        }
        return response;
      };
    });
    // Extend only the nested export read and its history write. Both execute
    // actual authenticated-role SQL with the request's synthetic bearer user.
    await ctx.route('https://mfda-security.invalid/rest/v1/*', async route => {
      const req = route.request(), url = new URL(req.url());
      const table = url.pathname.split('/').at(-1);
      if (!['mail_list_items', 'mail_exports'].includes(table)) return route.fallback();
      const uid = JSON.parse(Buffer.from(req.headers().authorization.split('.')[1], 'base64url')).sub;
      if (table === 'mail_exports' && req.method() === 'POST') {
        const row = req.postDataJSON();
        await db.sql(`insert into public.mail_exports(org_id,list_id,format,row_count,created_by)
          values (${q(row.org_id)},${row.list_id ? q(row.list_id) : 'null'},'freedomsoft',${q(row.row_count)},${q(row.created_by)})`, uid);
        logs.push({ uid, ...row });
        return route.fulfill({ status: 201, contentType: 'application/json', body: 'null' });
      }
      if (table !== 'mail_list_items' || req.method() !== 'GET') return route.fallback();
      const list = url.searchParams.get('list_id')?.slice(3), org = url.searchParams.get('org_id')?.slice(3);
      assert.ok([listA, listB].includes(list)); assert.ok([ids.oa, ids.ob].includes(org));
      assert.equal(url.searchParams.get('select'), 'parcels(*)');
      const body = await db.sql(`select coalesce(jsonb_agg(jsonb_build_object('parcels',to_jsonb(p))),'[]')
        from public.mail_list_items i join public.parcels p on p.id=i.parcel_id
        where i.list_id=${q(list)} and i.org_id=${q(org)}`, uid);
      const retryable = control.failuresRemaining > 0;
      if (retryable) control.failuresRemaining--;
      const failed = control.fail || retryable;
      let release;
      const held = control.hold ? new Promise(r => release = r) : Promise.resolve();
      if (release) pending.push(release);
      requests.push({ uid, org, list, body, failed });
      await held;
      await route.fulfill({ status: failed ? (retryable ? 503 : 400) : 200, contentType: 'application/json',
        body: failed ? JSON.stringify({ message: 'Synthetic export failure' }) : body }).catch(() => {});
    });
    await page.goto(h.base + '/off-market');
    await page.getByRole('button', { name: /Saved mail lists/ }).waitFor();
    await page.evaluate(({ code, b }) => {
      window.oldExportClient = eval('(' + code + ')')()[0];
      new MutationObserver(() => {
        const header = document.querySelector('header');
        const selector = header?.querySelector('select');
        const underB = selector ? selector.value === b : header?.innerText.includes('Synthetic Tenant B');
        if (underB && /A ONLY/.test(document.body.innerText)) window.exportLeaks.push(document.body.innerText);
      }).observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true });
    }, { code: clientsInPage.toString(), b: ids.ob });
    async function start(name = 'A ONLY DELAYED EXPORT') {
      const row = page.getByRole('row').filter({ hasText: name });
      if (await row.count() === 0) await page.getByRole('button', { name: /Saved mail lists/ }).click();
      const before = requests.length;
      await row.getByRole('button', { name: /CSV/ }).click();
      await eventually(() => requests.length > before);
      return requests.at(-1);
    }
    async function settle(expected = requests.length) {
      await page.waitForFunction(n => window.exportResponses >= n, expected);
      await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
    }
    const release = () => { control.hold = false; pending.splice(0).forEach(r => r()); };
    async function noArtifact({ underB = true, detached = true } = {}) {
      await settle();
      assert.equal(downloads.length, 0);
      assert.equal(logs.length, 0, 'cancelled export must not log a completed export');
      assert.deepEqual(await page.evaluate(() => window.exportArtifacts), [], 'no CSV Blob, URL or download click');
      assert.deepEqual(await page.evaluate(() => window.exportLeaks), []);
      assert.equal(await page.getByRole('alert').count(), 0, 'normal scope cancellation is silent');
      if (underB) {
        assert.doesNotMatch(await page.locator('body').innerText(), /A ONLY/);
        const cache = await page.evaluate(code => eval('(' + code + ')')().map(c => c.getQueryCache().getAll().map(q => ({ key: q.queryKey, data: q.state.data }))), clientsInPage.toString());
        assert.doesNotMatch(JSON.stringify(cache), /A ONLY/);
        assert.ok(cache.flat().every(q => q.key[3] === ids.ob));
      }
      if (detached) assert.equal(await page.evaluate(() => window.oldExportClient.getQueryCache().getAll().length), 0);
    }
    async function bExport() {
      const next = page.waitForEvent('download');
      await start('B ONLY NORMAL EXPORT');
      const download = await next;
      const csv = await readFile(await download.path(), 'utf8');
      assert.match(csv, /B ONLY EXPORT PARCEL/); assert.doesNotMatch(csv, /A ONLY/);
      assert.equal(download.suggestedFilename(), 'b-only-normal-export.csv');
      await eventually(() => logs.length === 1);
      assert.equal(logs[0].org_id, ids.ob);
    }
    return { ctx, page, control, requests, downloads, logs, start, settle, release, noArtifact, bExport,
      close: async () => { release(); await ctx.close(); } };
  }
  const switchUser = async (f, id) => {
    await h.changeUser(f.page, id);
    await f.page.getByText(id === ids.b ? 'Synthetic Tenant B' : 'Synthetic Tenant A', { exact: true }).waitFor();
  };
  const switchOrg = async (f, org) => {
    await f.page.locator('header select').selectOption(org);
    await f.page.waitForFunction(id => document.querySelector('header select')?.value === id, org);
  };

  await t.test('A remains A: delayed saved CSV succeeds with its authorized contents and export log', async () => {
    const f = await fixture();
    try {
      f.control.hold = true; const request = await f.start();
      assert.equal(request.uid, ids.a); assert.equal(request.org, ids.oa); assert.match(request.body, /A ONLY PARCEL/);
      const next = f.page.waitForEvent('download'); f.release(); const download = await next;
      assert.match(await readFile(await download.path(), 'utf8'), /A ONLY PARCEL CANARY/);
      assert.equal(download.suggestedFilename(), 'a-only-delayed-export.csv');
      await eventually(() => f.logs.length === 1);
      assert.equal(f.logs[0].created_by, ids.a); assert.equal(f.logs[0].row_count, 1);
    } finally { await f.close(); }
  });
  await t.test('auth A → B before a held authorized response: no artifact/cache leak; B export still works', async () => {
    const f = await fixture();
    try {
      f.control.hold = true; await f.start(); await switchUser(f, ids.b);
      assert.equal(await db.sql(`select count(*) from public.parcels where id=${q(ids.parcel)}`, ids.b), '0');
      f.release(); await f.noArtifact(); await f.bExport();
    } finally { await f.close(); }
  });
  await t.test('org A → B with the same authorized user suppresses A; B export still works', async () => {
    const f = await fixture(ids.both);
    try {
      f.control.hold = true; await f.start(); await switchOrg(f, ids.ob);
      f.release(); await f.noArtifact(); await f.bExport();
      assert.equal(f.logs[0].created_by, ids.both);
    } finally { await f.close(); }
  });
  await t.test('auth A → B → A does not resurrect the first export', async () => {
    const f = await fixture();
    try {
      f.control.hold = true; await f.start();
      await switchUser(f, ids.b); await switchUser(f, ids.a);
      f.release(); await f.noArtifact({ underB: false });
      const next = f.page.waitForEvent('download'); await f.start();
      assert.match(await readFile(await (await next).path(), 'utf8'), /A ONLY PARCEL CANARY/);
    } finally { await f.close(); }
  });
  await t.test('org A → B → A does not resurrect the first export', async () => {
    const f = await fixture(ids.both);
    try {
      f.control.hold = true; await f.start(); await switchOrg(f, ids.ob); await switchOrg(f, ids.oa);
      f.release(); await f.noArtifact({ underB: false });
    } finally { await f.close(); }
  });
  await t.test('a held failure after auth replacement is silently cancelled and B can export', async () => {
    const f = await fixture();
    try {
      f.control.hold = true; f.control.fail = true; await f.start(); await switchUser(f, ids.b);
      f.release(); await f.noArtifact(); f.control.fail = false; await f.bExport();
    } finally { await f.close(); }
  });
  await t.test('failed A export retried under A then completed under B cannot release A', async () => {
    const f = await fixture();
    try {
      f.control.fail = true; await f.start(); await f.settle();
      await f.page.getByRole('alert').filter({ hasText: 'Synthetic export failure' }).waitFor();
      f.control.fail = false; f.control.hold = true; await f.start();
      await switchUser(f, ids.b); f.release(); await f.noArtifact(); await f.bExport();
      assert.equal(f.requests.filter(r => r.org === ids.oa).length, 2);
    } finally { await f.close(); }
  });
  await t.test('SDK retries a failed A request after B becomes active; the successful retry is discarded', async () => {
    const f = await fixture();
    try {
      f.control.failuresRemaining = 1; f.control.hold = true;
      await f.start(); await switchUser(f, ids.b); f.release();
      await eventually(() => f.requests.length === 2);
      assert.equal(f.requests[0].failed, true); assert.equal(f.requests[1].failed, false);
      assert.equal(f.requests[1].uid, ids.b, 'the SDK retries with the current token');
      assert.equal(f.requests[1].org, ids.oa, 'the obsolete operation still carries its original org filter');
      assert.deepEqual(JSON.parse(f.requests[1].body), [], 'B RLS denies A rows; even an empty stale CSV/name must be suppressed');
      await f.noArtifact(); await f.bExport();
    } finally { await f.close(); }
  });
  await t.test('same org/role with a different authenticated user still cancels the old export', async () => {
    const f = await fixture(ids.both);
    try {
      f.control.hold = true; await f.start(); await h.changeUser(f.page, ids.admin);
      await f.page.getByText('admin@example.invalid', { exact: true }).waitFor();
      f.release(); await f.noArtifact({ underB: false });
    } finally { await f.close(); }
  });
  await t.test('unchanged identity token renewal preserves an in-flight authorized export', async () => {
    const f = await fixture();
    try {
      f.control.hold = true; await f.start(); await h.changeUser(f.page, ids.a, 1);
      const next = f.page.waitForEvent('download'); f.release();
      assert.match(await readFile(await (await next).path(), 'utf8'), /A ONLY PARCEL CANARY/);
    } finally { await f.close(); }
  });
  await t.test('role downgrade invalidates a pending export even within the same org/user', async () => {
    const f = await fixture(ids.both);
    try {
      f.control.hold = true; await f.start();
      await db.sql(`update public.org_members set role='member' where org_id=${q(ids.oa)} and user_id=${q(ids.both)}`);
      await f.page.evaluate(() => dispatchEvent(new Event('focus')));
      await f.page.getByRole('button', { name: /Saved mail lists/ }).waitFor();
      f.release(); await f.noArtifact({ underB: false });
    } finally {
      await db.sql(`update public.org_members set role='admin' where org_id=${q(ids.oa)} and user_id=${q(ids.both)}`);
      await f.close();
    }
  });
  await t.test('membership removal suppresses an already authorized delayed response', async () => {
    const f = await fixture();
    try {
      f.control.hold = true; await f.start();
      await db.sql(`delete from public.org_members where user_id=${q(ids.a)} and org_id=${q(ids.oa)}`);
      await f.page.evaluate(() => dispatchEvent(new Event('focus')));
      await f.page.getByText('No organization access.', { exact: false }).waitFor();
      f.release(); await f.noArtifact({ underB: false });
    } finally {
      await db.sql(`insert into public.org_members(org_id,user_id,role) values (${q(ids.oa)},${q(ids.a)},'member') on conflict do nothing`);
      await f.close();
    }
  });
  await t.test('filtered current-parcel CSV uses the same guarded download boundary', async () => {
    const f = await fixture();
    try {
      await f.page.getByText('A ONLY PARCEL CANARY', { exact: true }).waitFor();
      const next = f.page.waitForEvent('download');
      await f.page.getByRole('button', { name: /Export FreedomSoft CSV/ }).click();
      assert.match(await readFile(await (await next).path(), 'utf8'), /A ONLY PARCEL CANARY/);
      await eventually(() => f.logs.length === 1); assert.equal(f.logs[0].list_id, null);
    } finally { await f.close(); }
  });
  await t.test('delayed mutation success cannot navigate B to an A result', async () => {
    const f = await fixture(); let release, started;
    const begun = new Promise(r => started = r), held = new Promise(r => release = r);
    await f.ctx.route('https://mfda-security.invalid/rest/v1/deals*', async route => {
      if (route.request().method() !== 'PATCH') return route.fallback();
      const req = route.request(), url = new URL(req.url()), row = req.postDataJSON();
      const uid = JSON.parse(Buffer.from(req.headers().authorization.split('.')[1], 'base64url')).sub;
      assert.equal(row.status, 'analyzing');
      await db.sql(`update public.deals set status='analyzing' where id=${q(url.searchParams.get('id').slice(3))}`, uid);
      started(); await held;
      await route.fulfill({ status: 200, contentType: 'application/json', body: 'null' });
    });
    try {
      await h.route(f.page, '/on-market');
      await f.page.getByRole('row').filter({ hasText: 'A ONLY LISTING CANARY' }).getByRole('button', { name: /Analyze/ }).click();
      await begun; await switchUser(f, ids.b);
      const complete = f.page.waitForResponse(r => r.request().method() === 'PATCH');
      release(); await (await complete).finished();
      await f.page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
      assert.equal(new URL(f.page.url()).pathname, '/on-market');
      assert.doesNotMatch(await f.page.locator('body').innerText(), /A ONLY/);
      assert.equal(f.downloads.length, 0);
    } finally { release(); await f.close(); }
  });
  await t.test('an authorized current-tenant PDF still produces a valid browser download', async () => {
    const f = await fixture();
    try {
      await h.route(f.page, `/deals/${ids.deal}`);
      const link = f.page.getByRole('link', { name: 'PDF report', exact: true });
      await link.waitFor();
      assert.match(await link.getAttribute('href'), /^blob:/);
      const next = f.page.waitForEvent('download'); await link.click();
      const download = await next, pdf = await readFile(await download.path());
      assert.equal(pdf.subarray(0, 5).toString(), '%PDF-');
      assert.equal(download.suggestedFilename(), 'a-only-security-canary-report.pdf');
    } finally { await f.close(); }
  });
  assert.deepEqual(h.errors, [], 'application and SQL-adapter errors fail this suite');
});
