import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { database, ids, quote as q, root } from './db-harness.mjs';

// Real PostgreSQL functions, triggers, permissions and RLS; no mocked grants.
test('invitation authorization at the trusted database boundary', async (t) => {
  const db = await database();
  t.after(() => db.close());
  const email = 'recipient@example.invalid';
  const recipient = randomUUID();
  await db.sql(`insert into auth.users values (${q(recipient)},${q(email)},clock_timestamp())`);
  async function invite({ role = 'member', expires = "clock_timestamp()+interval '1 hour'", accepted = 'null', target = ids.oa, address = email } = {}) {
    const token = randomUUID();
    await db.sql(`insert into public.invites(org_id,email,role,token,expires_at,accepted_at) values (${q(target)},${q(address)},${q(role)},${q(token)},${expires},${accepted})`);
    return token;
  }
  const redeem = (token, user = recipient) => db.sql(`select public.redeem_invite(${q(token)}::uuid)`, user);
  const membership = (user = recipient) => db.sql(`select coalesce(json_agg(row_to_json(m)),'[]') from public.org_members m where user_id=${q(user)}`);
  async function rejected(token, user = recipient) {
    const before = await membership(user);
    await assert.rejects(redeem(token, user), /Invitation unavailable/);
    assert.equal(await membership(user), before, 'rejection must not create or upgrade membership');
  }
  await t.test('expired invitation rejected; gate and bootstrap agree', async () => {
    const token = await invite({ role: 'admin', expires: "clock_timestamp()-interval '1 day'" });
    assert.equal(await db.sql(`select public.is_email_allowed(${q(email)})`), 'f');
    await rejected(token);
    const newUser = randomUUID();
    await db.sql(`insert into auth.users values (${q(newUser)},${q(email)},clock_timestamp())`);
    assert.equal(await membership(newUser), '[]');
  });
  await t.test('deleted/revoked invitation rejected', async () => {
    const token = await invite();
    await db.sql(`delete from public.invites where token=${q(token)}`);
    await rejected(token);
  });
  await t.test('invalid token and row ID rejected', async () => {
    await rejected(randomUUID());
    const token = await invite();
    const id = await db.sql(`select id from public.invites where token=${q(token)}`);
    await rejected(id);
    await db.sql(`delete from public.invites where token=${q(token)}`);
  });
  await t.test('wrong user and client-supplied identity cannot redeem', async () => {
    const token = await invite();
    await rejected(token, ids.b);
    await assert.rejects(db.sql(`select public.accept_mfda_invite(${q(token)},${q(recipient)})`, ids.b), /permission denied/);
    await db.sql(`delete from public.invites where token=${q(token)}`);
  });
  await t.test('unconfirmed email cannot consume invitation; confirmation grants member only', async () => {
    const u = randomUUID(), address = 'unconfirmed@example.invalid';
    const token = await invite({ address });
    await db.sql(`insert into auth.users values (${q(u)},${q(address)},null)`);
    assert.equal(await membership(u), '[]');
    await rejected(token, u);
    await db.sql(`update auth.users set email_confirmed_at=clock_timestamp() where id=${q(u)}`);
    assert.match(await membership(u), /"role":"member"/);
    await rejected(token, u);
  });
  await t.test('expiration at exact boundary rejected in either timezone', async () => {
    const token = await invite({ expires: 'clock_timestamp()' });
    await rejected(token);
    await assert.rejects(db.sql(`set timezone='Pacific/Kiritimati'; select public.redeem_invite(${q(token)})`, recipient), /Invitation unavailable/);
  });
  await t.test('transaction started before expiry cannot redeem after expiry', async () => {
    const token = await invite({ expires: "clock_timestamp()+interval '150 milliseconds'" });
    await assert.rejects(db.sql(`begin; select pg_sleep(0.25); select public.redeem_invite(${q(token)}); commit;`, recipient), /Invitation unavailable/);
    assert.equal(await membership(), '[]');
  });
  await t.test('expiration while waiting for validation lock creates no membership', async () => {
    const u = randomUUID(), address = 'lock-expiry@example.invalid';
    await db.sql(`insert into auth.users values (${q(u)},${q(address)},clock_timestamp())`);
    const token = await invite({ address, expires: "clock_timestamp()+interval '250 milliseconds'" });
    const lock = db.sql(`begin; select token from public.invites where token=${q(token)} for update; select pg_sleep(0.5); commit;`);
    await new Promise((r) => setTimeout(r, 100));
    await rejected(token, u); await lock;
    assert.equal(await membership(u), '[]');
    assert.equal(await db.sql(`select accepted_at is null from public.invites where token=${q(token)}`), 't');
  });
  await t.test('member cannot forge org, role, invitation record or membership', async () => {
    const token = await invite();
    await assert.rejects(db.sql(`select public.redeem_invite(${q(token)},${q(ids.ob)},'admin')`, recipient), /does not exist/);
    assert.equal(await db.sql(`update public.invites set role='admin',org_id=${q(ids.ob)} where token=${q(token)} returning id`, recipient), '');
    await assert.rejects(db.sql(`insert into public.org_members values (${q(ids.ob)},${q(recipient)},'admin',now())`, recipient), /row-level security/);
    assert.equal(await redeem(token), ids.oa);
    assert.equal(await db.sql(`select role from public.org_members where org_id=${q(ids.oa)} and user_id=${q(recipient)}`), 'member');
    assert.equal(await db.sql(`select count(*) from public.org_members where org_id=${q(ids.ob)} and user_id=${q(recipient)}`), '0');
    await rejected(token);
  });
  await t.test('already-consumed invitation cannot be reset, retargeted or reused', async () => {
    const token = await invite({ accepted: 'clock_timestamp()', role: 'admin' });
    await rejected(token);
    await assert.rejects(db.sql(`update public.invites set accepted_at=null where token=${q(token)}`, ids.admin), /immutable/);
    await assert.rejects(db.sql(`update public.invites set role='member',org_id=${q(ids.ob)} where token=${q(token)}`, ids.admin), /immutable/);
  });
  await t.test('fresh valid admin invitation cannot upgrade existing member', async () => {
    const token = await invite({ role: 'admin' });
    await redeem(token);
    assert.equal(await db.sql(`select role from public.org_members where user_id=${q(recipient)}`), 'member');
  });
  await t.test('concurrent redemption grants exactly one membership and one consumption', async () => {
    const u = randomUUID(), address = 'concurrent@example.invalid';
    await db.sql(`insert into auth.users values (${q(u)},${q(address)},clock_timestamp())`);
    const token = await invite({ address });
    const results = await Promise.allSettled(Array.from({ length: 8 }, () => redeem(token, u)));
    assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
    assert.equal(results.filter((r) => r.status === 'rejected' && /Invitation unavailable/.test(r.reason.message)).length, 7);
    assert.equal(await db.sql(`select count(*) from public.org_members where user_id=${q(u)} and role='member'`), '1');
    await rejected(token, u);
  });
  await t.test('revocation lock completes before waiting redemption', async () => {
    const token = await invite();
    const revoke = db.sql(`begin; delete from public.invites where token=${q(token)}; select pg_sleep(0.3); commit;`);
    await new Promise((r) => setTimeout(r, 100));
    await rejected(token);
    await revoke;
  });
  await t.test('membership remains absent while invitation validation waits for its lock', async () => {
    const u = randomUUID(), address = 'locked@example.invalid';
    await db.sql(`insert into auth.users values (${q(u)},${q(address)},clock_timestamp())`);
    const token = await invite({ address });
    const lock = db.sql(`begin; select token from public.invites where token=${q(token)} for update; select pg_sleep(0.5); commit;`);
    await new Promise((r) => setTimeout(r, 100));
    const pending = redeem(token, u);
    await new Promise((r) => setTimeout(r, 100));
    assert.equal(await membership(u), '[]');
    await lock; await pending;
    assert.match(await membership(u), /\"role\":\"member\"/);
  });
  await t.test('membership failure rolls back consumption atomically', async () => {
    const u = randomUUID(), address = 'atomic@example.invalid';
    await db.sql(`insert into auth.users values (${q(u)},${q(address)},clock_timestamp())`);
    const token = await invite({ address });
    await db.sql(`create function public.test_reject_membership() returns trigger language plpgsql as $fixture$ begin if new.user_id=${q(u)} then raise exception 'Synthetic membership failure'; end if; return new; end; $fixture$;
      create trigger test_reject_membership before insert on public.org_members for each row execute function public.test_reject_membership();`);
    try {
      await assert.rejects(redeem(token,u), /Synthetic membership failure/);
      assert.equal(await membership(u),'[]');
      assert.equal(await db.sql(`select accepted_at is null from public.invites where token=${q(token)}`),'t');
    } finally { await db.sql('drop trigger test_reject_membership on public.org_members; drop function public.test_reject_membership()'); }
  });
  await t.test('uninvited user has no default administrative membership', async () => {
    const u = randomUUID();
    await db.sql(`insert into auth.users values (${q(u)},'uninvited@example.invalid',clock_timestamp())`);
    assert.equal(await membership(u), '[]');
  });
  await t.test('valid new-user admin invitation still works explicitly', async () => {
    const u = randomUUID(), address = 'valid-admin@example.invalid';
    const token = await invite({ address, role: 'admin' });
    await db.sql(`insert into auth.users values (${q(u)},${q(address)},clock_timestamp())`);
    assert.match(await membership(u), /"role":"admin"/);
    await rejected(token, u);
  });
  await t.test('valid returning-user invitation works through session RPC', async () => {
    const token = await invite({ target: ids.ob });
    await db.sql('select public.accept_pending_mfda_invites()', recipient);
    assert.equal(await db.sql(`select role from public.org_members where user_id=${q(recipient)} and org_id=${q(ids.ob)}`), 'member');
    await rejected(token);
  });
  await t.test('RLS denies B reads and foreign insert/update/delete after rejection', async () => {
    assert.equal(await db.sql(`select count(*) from public.deals where id=${q(ids.deal)}`, ids.b), '0');
    await assert.rejects(db.sql(`insert into public.deals(org_id,dedupe_key) values (${q(ids.oa)},'forged')`, ids.b), /row-level security/);
    await assert.rejects(db.sql(`update public.deals set org_id=${q(ids.ob)} where id=${q(ids.deal)}`, ids.a), /row-level security/);
    assert.equal(await db.sql(`delete from public.deals where id=${q(ids.deal)} returning id`, ids.b), '');
    assert.equal(await db.sql(`update public.org_members set role='admin' where user_id=${q(ids.b)} returning user_id`, ids.b), '');
    assert.equal(await db.sql(`select count(*) from public.deals`, ids.a), '1');
  });
  await t.test('all tenant tables retain RLS and private redemption helper permissions', async () => {
    assert.equal(await db.sql("select count(*) from pg_class c join pg_namespace n on c.relnamespace=n.oid where n.nspname='public' and c.relkind='r' and not c.relrowsecurity"), '0');
    assert.equal(await db.sql("select has_function_privilege('anon','public.redeem_invite(uuid)','execute')"), 'f');
    assert.equal(await db.sql("select has_function_privilege('authenticated','public.accept_mfda_invite(uuid,uuid)','execute')"), 'f');
  });
  await t.test('forward migration reapplies without losing memberships or reopening consumption', async () => {
    const before = await membership();
    await db.sql(await readFile(path.join(root, 'supabase/migration_015_p0_invitation_authorization.sql'), 'utf8'));
    assert.equal(await membership(), before);
  });
});
