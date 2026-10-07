// Expected-vulnerable controls from the required immutable source baseline.
// Passing these controls proves the harness detects both original defects.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { database, ids, quote as q, root } from './db-harness.mjs';
import { browserHarness } from './browser-harness.mjs';
const exec = promisify(execFile);
const baseline = 'c800392a3c57cb425dc9ab90ca3cda4893b2e5fd';

test('baseline controls reproduce the original P0s in isolated source/SQL', async (t) => {
  const db = await database({ baseline: true });
  let h;
  t.after(async () => { try { await h?.close(); } finally { await db.close(); } });
  await t.test('original migration chain grants expired invitation administration', async () => {
    await db.sql(`insert into public.invites(org_id,email,role,expires_at) values (${q(ids.oa)},'expired-control@example.invalid','admin',clock_timestamp()-interval '1 day')`);
    assert.equal(await db.sql("select public.is_email_allowed('expired-control@example.invalid')"), 'f');
    await db.sql("insert into auth.users values ('10000000-0000-0000-0000-000000000099','expired-control@example.invalid',clock_timestamp())");
    assert.equal(await db.sql("select role from public.org_members where user_id='10000000-0000-0000-0000-000000000099' and org_id="+q(ids.oa)), 'admin');
  });
  const archive = path.join(db.dir, 'baseline');
  const { stdout } = await exec('git', ['ls-tree','-r','--name-only',baseline,'mfda','packages/mf-calc'], { cwd: path.dirname(root) });
  for (const file of stdout.trim().split('\n')) {
    const destination = path.join(archive, file);
    await mkdir(path.dirname(destination), { recursive: true });
    const { stdout: contents } = await exec('git', ['show',baseline+':'+file], { cwd: path.dirname(root), maxBuffer: 4*1024*1024 });
    await writeFile(destination, contents);
  }
  await symlink(path.join(root,'node_modules'), path.join(archive,'mfda/node_modules'));
  h = await browserHarness(db, { appRoot: path.join(archive,'mfda') });
  await t.test('original SPA displays cached A deal under B while actual PostgreSQL denies B', async () => {
    const { ctx, page } = await h.context();
    try {
      await page.goto(h.base+`/deals/${ids.deal}`);
      await page.getByRole('heading',{name:/A ONLY SECURITY CANARY/}).waitFor();
      await page.getByRole('button',{name:'Sign out',exact:true}).click();
      await page.waitForURL('**/signin');
      await h.changeUser(page,ids.b);
      // Original membership listing returns duplicate org options. Wait for
      // the selected organization, preserving the stale-data assertion below.
      await page.waitForFunction((id) => document.querySelector('header select')?.value === id, ids.ob);
      h.control.delay=1500;
      await h.route(page,`/deals/${ids.deal}`);
      assert.equal(await page.getByRole('heading',{name:/A ONLY SECURITY CANARY/}).isVisible(),true);
      assert.match(await page.locator('header').innerText(),/b@example.invalid/);
      assert.equal(await db.sql(`select count(*) from public.deals where id=${q(ids.deal)}`,ids.b),'0');
      await page.getByText('Record unavailable',{exact:true}).waitFor({timeout:20000});
    } finally { h.control.delay=0; await ctx.close(); }
  });
  assert.deepEqual(h.errors,[]);
});
