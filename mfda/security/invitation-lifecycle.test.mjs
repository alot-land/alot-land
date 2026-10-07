import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { database, ids, quote as q, root } from './db-harness.mjs';

test('invitation history and authorized Auth-user deletion survive migration 015', async t => {
  // Real preceding chain and populated upgrade; the existing invitation suite
  // separately loads the complete corrected chain into a fresh database.
  const db = await database({ baseline: true }); t.after(() => db.close());
  const migration = await readFile(root + '/supabase/migration_015_p0_invitation_authorization.sql', 'utf8');
  const author = randomUUID(), token = randomUUID(), pending = randomUUID();
  await db.sql(`insert into auth.users values (${q(author)},'historical-author@example.invalid',clock_timestamp());
    insert into public.org_members(org_id,user_id,role) values (${q(ids.oa)},${q(author)},'admin');
    insert into public.invites(org_id,email,role,token,invited_by,accepted_at) values
      (${q(ids.oa)},'a@example.invalid','admin',${q(token)},${q(author)},clock_timestamp()),
      (${q(ids.oa)},'pending@example.invalid','member',${q(pending)},${q(author)},null);
    insert into public.notes(org_id,entity_type,entity_id,body,created_by,author_email) values
      (${q(ids.oa)},'deal',${q(ids.deal)},'History survives author deletion',${q(author)},'historical-author@example.invalid');
    create role lifecycle_auth_writer nologin;
    grant usage on schema auth to lifecycle_auth_writer;
    grant select(id),delete on auth.users to lifecycle_auth_writer;`);
  const memberships = () => db.sql('select jsonb_agg(to_jsonb(m) order by org_id,user_id) from public.org_members m');
  const invites = () => db.sql('select jsonb_agg(to_jsonb(i) order by id) from public.invites i');
  const consumed = () => db.sql(`select to_jsonb(i) from public.invites i where token=${q(token)}`);
  const original = JSON.parse(await consumed());
  await t.test('populated upgrade preserves all invitation and membership rows', async () => {
    const beforeMembers = await memberships(), beforeInvites = await invites();
    await db.sql(migration);
    assert.equal(await memberships(), beforeMembers);
    assert.equal(await invites(), beforeInvites);
  });
  await t.test('all consumed fields reject changes, including author nulling by an org admin', async () => {
    const changes = {
      id: q(randomUUID()), org_id: q(ids.ob), email: "'retarget@example.invalid'", role: "'member'",
      token: q(randomUUID()), invited_by: 'null', accepted_at: 'null',
      expires_at: "clock_timestamp()+interval '1 year'", created_at: 'clock_timestamp()',
    };
    for (const [column, value] of Object.entries(changes)) {
      await assert.rejects(db.sql(`update public.invites set ${column}=${value} where token=${q(token)}`, ids.admin), /immutable/, column);
      assert.deepEqual(JSON.parse(await consumed()), original);
    }
    await assert.rejects(db.sql(`update public.invites set invited_by=${q(ids.admin)} where token=${q(token)}`, ids.admin), /immutable/);
    await assert.rejects(db.sql(`update public.invites set invited_by=null,accepted_at=null where token=${q(token)}`, ids.admin), /immutable/);
    await db.sql(`update public.invites set accepted_at=accepted_at where token=${q(token)}`, ids.admin);
  });
  await t.test('client roles cannot delete Auth users or execute the private trigger/helper', async () => {
    await assert.rejects(db.sql(`delete from auth.users where id=${q(author)}`, ids.admin), /permission denied/);
    for (const role of ['anon', 'authenticated', 'lifecycle_auth_writer']) {
      assert.equal(await db.sql(`select has_function_privilege(${q(role)},'public.protect_consumed_mfda_invite()','execute')`), 'f');
      assert.equal(await db.sql(`select has_function_privilege(${q(role)},'public.accept_mfda_invite(uuid,uuid)','execute')`), 'f');
    }
    assert.equal(await db.sql("select has_function_privilege('authenticated','public.redeem_invite(uuid)','execute')"), 't');
    assert.equal(await db.sql("select has_function_privilege('anon','public.redeem_invite(uuid)','execute')"), 'f');
    assert.equal(await db.sql("select has_function_privilege('authenticated','public.accept_pending_mfda_invites()','execute')"), 't');
  });
  await t.test('restricted authorized Auth writer deletes author; only historical author FK becomes null', async () => {
    const remaining = await db.sql(`select jsonb_agg(to_jsonb(m) order by org_id,user_id) from public.org_members m where user_id<>${q(author)}`);
    const organizations = await db.sql('select jsonb_agg(to_jsonb(o) order by id) from public.orgs o');
    await db.sql(`set role lifecycle_auth_writer; delete from auth.users where id=${q(author)}`);
    assert.equal(await db.sql(`select count(*) from auth.users where id=${q(author)}`), '0');
    assert.deepEqual(JSON.parse(await consumed()), { ...original, invited_by: null });
    assert.equal(await db.sql(`select invited_by is null and accepted_at is null from public.invites where token=${q(pending)}`), 't');
    assert.equal(await memberships(), remaining, 'only the deleted user memberships cascade');
    assert.equal(await db.sql('select jsonb_agg(to_jsonb(o) order by id) from public.orgs o'), organizations);
    assert.equal(await db.sql(`select count(*) from public.deals where id=${q(ids.deal)}`), '1');
    assert.equal(await db.sql("select created_by is null and author_email='historical-author@example.invalid' from public.notes where body='History survives author deletion'"), 't');
  });
  await t.test('author cleanup cannot reactivate, retarget, reattribute or replay a consumed invite', async () => {
    for (const change of ['accepted_at=null', "role='member'", `invited_by=${q(ids.admin)}`, `token=${q(randomUUID())}`]) {
      await assert.rejects(db.sql(`update public.invites set ${change} where token=${q(token)}`, ids.admin), /immutable/);
    }
    await assert.rejects(db.sql(`select public.redeem_invite(${q(token)})`, ids.a), /Invitation unavailable/);
    assert.deepEqual(JSON.parse(await consumed()), { ...original, invited_by: null });
  });
  await t.test('recipient deletion preserves email history and consumption; a new same-email user cannot replay', async () => {
    const before = await consumed();
    const remaining = await db.sql(`select jsonb_agg(to_jsonb(m) order by org_id,user_id) from public.org_members m where user_id<>${q(ids.a)}`);
    await db.sql(`set role lifecycle_auth_writer; delete from auth.users where id=${q(ids.a)}`);
    assert.equal(await consumed(), before, 'recipient is recorded by email, with no recipient Auth FK');
    assert.equal(await memberships(), remaining);
    const replacement = randomUUID();
    await db.sql(`insert into auth.users values (${q(replacement)},'a@example.invalid',clock_timestamp())`);
    assert.equal(await db.sql(`select count(*) from public.org_members where user_id=${q(replacement)}`), '0');
    await assert.rejects(db.sql(`select public.redeem_invite(${q(token)})`, replacement), /Invitation unavailable/);
  });
  await t.test('valid redemption after author deletion works and never escalates an existing member', async () => {
    const u = randomUUID(), fresh = randomUUID(), escalation = randomUUID();
    await db.sql(`insert into auth.users values (${q(u)},'fresh-lifecycle@example.invalid',clock_timestamp());
      insert into public.invites(org_id,email,token) values (${q(ids.oa)},'fresh-lifecycle@example.invalid',${q(fresh)})`);
    assert.equal(await db.sql(`select public.redeem_invite(${q(fresh)})`, u), ids.oa);
    await db.sql(`insert into public.invites(org_id,email,role,token) values (${q(ids.oa)},'fresh-lifecycle@example.invalid','admin',${q(escalation)})`);
    await db.sql(`select public.redeem_invite(${q(escalation)})`, u);
    assert.equal(await db.sql(`select role from public.org_members where user_id=${q(u)}`), 'member');
    for (const used of [fresh, escalation]) await assert.rejects(db.sql(`select public.redeem_invite(${q(used)})`, u), /Invitation unavailable/);
  });
  await t.test('repeat migration preserves rows, consumption and effective grants', async () => {
    const beforeMembers = await memberships(), beforeInvites = await invites();
    await db.sql(migration); await db.sql(migration);
    assert.equal(await memberships(), beforeMembers); assert.equal(await invites(), beforeInvites);
    assert.equal(await db.sql("select has_function_privilege('authenticated','public.protect_consumed_mfda_invite()','execute')"), 'f');
  });
});
