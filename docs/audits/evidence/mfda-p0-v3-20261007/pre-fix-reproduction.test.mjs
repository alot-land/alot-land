// Run only against the required V2 starting SHA. All external traffic is stubbed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { database, ids, quote as q } from '../../../../mfda/security/db-harness.mjs';
import { browserHarness } from '../../../../mfda/security/browser-harness.mjs';
import handler from '../../../../mfda/netlify/functions/rent-estimate.mjs';

test('pre-fix N-1: held A cache miss starts A RentCast proxy request under B', async t => {
  const db = await database(); let h, release;
  t.after(async () => { release?.(); try { await h?.close(); } finally { await db.close(); } });
  await db.sql(`update public.deals set zip='85001' where id=${q(ids.deal)};
    insert into public.rent_bands(org_id,source,zip,period,bedrooms,rent)
    values (${q(ids.oa)},'zori','85001','2026-10',-1,1500);`);
  h = await browserHarness(db);
  const { ctx, page } = await h.context();
  const held = new Promise(r => release = r);
  let cacheSeen;
  const cacheStarted = new Promise(r => cacheSeen = r);
  await ctx.route('**/rest/v1/rent_estimates?*', async route => {
    const req = route.request();
    assert.equal(req.method(), 'GET');
    assert.equal(JSON.parse(Buffer.from(req.headers().authorization.split('.')[1], 'base64url')).sub, ids.a);
    assert.equal(await db.sql(`select count(*) from public.rent_estimates where org_id=${q(ids.oa)}`, ids.a), '0');
    cacheSeen(); await held;
    await route.fulfill({ contentType: 'application/json', body: '[]' });
  });
  let proxySeen;
  const proxyStarted = new Promise(r => proxySeen = r);
  await ctx.route('**/.netlify/functions/rent-estimate?*', async route => {
    const req = route.request();
    const observation = { address: new URL(req.url()).searchParams.get('address'),
      authorization: req.headers().authorization ?? null,
      activeHeader: await page.locator('header').innerText(),
      activeUser: await page.evaluate(async () => (await (await import('/src/lib/supabase.js')).supabase.auth.getSession()).data.session.user.id) };
    proxySeen(observation);
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ rent: 1731, source: 'rentcast' }) });
  });
  await page.goto(h.base + `/deals/${ids.deal}/edit`);
  await page.getByRole('button', { name: /Address-level/ }).click();
  await cacheStarted;
  await h.changeUser(page, ids.b);
  await page.getByText('Synthetic Tenant B', { exact: true }).waitFor();
  release();
  const observation = await Promise.race([proxyStarted, new Promise((_, reject) => setTimeout(() => reject(new Error('no stale proxy request')), 15000))]);
  assert.equal(observation.activeUser, ids.b);
  assert.match(observation.activeHeader, /Synthetic Tenant B/);
  assert.match(observation.address, /A ONLY SECURITY CANARY/);
  assert.equal(observation.authorization, null);
  console.log('N-1 observed:', JSON.stringify(observation));
});

test('pre-fix real proxy accepts unauthenticated synthetic request', async t => {
  const nativeFetch = globalThis.fetch, oldKey = process.env.RENTCAST_API_KEY;
  t.after(() => { globalThis.fetch = nativeFetch; if (oldKey === undefined) delete process.env.RENTCAST_API_KEY; else process.env.RENTCAST_API_KEY = oldKey; });
  process.env.RENTCAST_API_KEY = 'SYNTHETIC-RENTCAST-KEY';
  const calls = [];
  globalThis.fetch = async (url, options) => { calls.push({ url, options }); return Response.json({ rent: 1731 }); };
  const response = await handler(new Request('http://localhost/.netlify/functions/rent-estimate?address=A+SYNTHETIC+ADDRESS'));
  assert.equal(response.status, 200); assert.equal(calls.length, 1);
  assert.equal(new URL(calls[0].url).hostname, 'api.rentcast.io');
  console.log('Unauthenticated proxy status:', response.status, 'stubbed upstream calls:', calls.length);
});
