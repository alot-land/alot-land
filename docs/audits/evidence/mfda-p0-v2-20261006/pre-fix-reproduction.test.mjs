import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { database, ids, quote as q } from '/Users/davidastone/code/alot-land/alot-land/mfda/security/db-harness.mjs';
import { browserHarness } from '/Users/davidastone/code/alot-land/alot-land/mfda/security/browser-harness.mjs';

test('V2 independent reproduction: consumed inviter deletion rolls back', async t => {
  const db = await database(); t.after(() => db.close());
  const token = randomUUID();
  await db.sql(`insert into public.invites(org_id,email,token,invited_by,accepted_at) values
    (${q(ids.oa)},'consumed@example.invalid',${q(token)},${q(ids.admin)},clock_timestamp())`);
  const before = await db.sql(`select to_jsonb(i) from public.invites i where token=${q(token)}`);
  await assert.rejects(db.sql(`delete from auth.users where id=${q(ids.admin)}`), /Consumed invitation is immutable/);
  assert.equal(await db.sql(`select to_jsonb(i) from public.invites i where token=${q(token)}`), before);
  assert.equal(await db.sql(`select count(*) from auth.users where id=${q(ids.admin)}`), '1');
  console.log('BLOCKER A CONFIRMED: authorized author deletion fails; user and consumed invitation unchanged.');
});

test('V2 independent reproduction: captured A response downloads after B renders', async t => {
  const db = await database(); let h;
  t.after(async () => { try { await h?.close(); } finally { await db.close(); } });
  h = await browserHarness(db);
  const list = await db.sql(`insert into public.mail_lists(org_id,name) values (${q(ids.oa)},'V2 A ONLY EXPORT') returning id`);
  await db.sql(`insert into public.mail_list_items(list_id,parcel_id,org_id) values (${q(list)},${q(ids.parcel)},${q(ids.oa)})`);
  const { ctx, page } = await h.context();
  let release, captured;
  const started = new Promise(r => captured = r), held = new Promise(r => release = r);
  await ctx.route('https://mfda-security.invalid/rest/v1/mail_list_items*', async route => {
    const req = route.request(), url = new URL(req.url());
    const uid = JSON.parse(Buffer.from(req.headers().authorization.split('.')[1], 'base64url')).sub;
    assert.equal(uid, ids.a);
    assert.equal(url.searchParams.get('org_id'), 'eq.' + ids.oa);
    const rows = await db.sql(`select jsonb_agg(jsonb_build_object('parcels',to_jsonb(p)))
      from public.mail_list_items i join public.parcels p on p.id=i.parcel_id
      where i.list_id=${q(list)} and i.org_id=${q(ids.oa)}`, uid);
    captured(); await held;
    await route.fulfill({ status: 200, contentType: 'application/json', body: rows });
  });
  try {
    await page.goto(h.base + '/off-market');
    await page.getByRole('button', { name: /Saved mail lists/ }).click();
    await page.getByRole('row').filter({ hasText: 'V2 A ONLY EXPORT' }).getByRole('button', { name: /CSV/ }).click();
    await started;
    await h.changeUser(page, ids.b);
    await page.getByText('Synthetic Tenant B', { exact: true }).waitFor();
    assert.doesNotMatch(await page.locator('body').innerText(), /A ONLY/);
    assert.equal(await db.sql(`select count(*) from public.parcels where id=${q(ids.parcel)}`, ids.b), '0');
    const downloaded = page.waitForEvent('download');
    release(); const download = await downloaded;
    assert.match(await readFile(await download.path(), 'utf8'), /A ONLY PARCEL CANARY/);
    console.log('BLOCKER B CONFIRMED: B receives', download.suggestedFilename(), 'containing A-only parcel data.');
  } finally { release(); await ctx.close(); }
  assert.deepEqual(h.errors, []);
});
