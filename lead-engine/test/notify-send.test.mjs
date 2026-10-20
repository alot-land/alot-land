import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

/**
 * Exercises the real notifier against a MOCKED provider. Nothing leaves the
 * machine — this is how "exactly one authorised notification" is proven without
 * mailing a listing agent to find out.
 */
const sent = [];
const realFetch = globalThis.fetch;

beforeEach(() => {
  sent.length = 0;
  process.env.RESEND_API_KEY = 'test-key-not-real';
  process.env.LEAD_NOTIFY_OWNER = 'david@alot.land';
  process.env.LEAD_NOTIFY_AGENTS = 'tony.alcott@outlook.com,ryan.schuler216@outlook.com';
  delete process.env.SMS_ENABLED;
  globalThis.fetch = async (url, opts) => {
    sent.push({ url: String(url), body: JSON.parse(opts?.body ?? '{}') });
    return new Response(JSON.stringify({ id: 'mock-' + sent.length }), { status: 200 });
  };
});
afterEach(() => { globalThis.fetch = realFetch; delete process.env.RESEND_API_KEY; });

const lead = (over = {}) => ({
  id: 'a'.repeat(32), name: 'Dana Whitfield', phone: '+16155550188', email: 'dana@example.com',
  lot: 'sugar-tree-vista-4-whitetail-view', lotName: 'Whitetail Ridge', lotPrice: '$49,900',
  inquiryType: 'showing', message: 'Road frontage?', attribution: { utm_source: 'facebook' },
  stage: 'new', createdAt: new Date().toISOString(), history: [], notifications: [], ...over,
});

test('a genuine new lead sends EXACTLY ONE notification, to all three', async () => {
  const { notifyAll } = await import('../notify.mjs?send1');
  const attempts = await notifyAll(lead(), { siteUrl: 'https://alot.land' });

  const emails = sent.filter(s => s.url.includes('resend.com'));
  assert.equal(emails.length, 1, 'one email, not one per recipient');
  const to = emails[0].body.to;
  assert.deepEqual([...to].sort(), ['david@alot.land', 'ryan.schuler216@outlook.com', 'tony.alcott@outlook.com']);
  assert.match(emails[0].body.subject, /New Sugar Tree lead/);
  assert.ok(emails[0].body.html && emails[0].body.text, 'branded HTML plus a text fallback');
  assert.equal(attempts.filter(a => a.status === 'accepted').length, 1);
  assert.equal(sent.filter(s => !s.url.includes('resend.com')).length, 0, 'no SMS — it is disabled');
});

test('THE P0: a synthetic record sends nothing at all', async () => {
  const { notifyAll, acknowledgeBuyer, escalate } = await import('../notify.mjs?send2');
  const t = lead({ name: 'TEST Log Probe' });
  const a = await notifyAll(t, { siteUrl: 'https://alot.land' });
  const b = await acknowledgeBuyer(t, { siteUrl: 'https://alot.land' });
  const c = await escalate(t, { siteUrl: 'https://alot.land' });
  assert.equal(sent.length, 0, 'not one request left the process');
  assert.equal(a[0].reason, 'test lead');
  assert.equal(b.reason, 'test lead');
  assert.equal(c.reason, 'test lead');
});

test('escalation for a real lead reaches the owner ONLY — never Tony', async () => {
  const { escalate } = await import('../notify.mjs?send3');
  await escalate(lead(), { siteUrl: 'https://alot.land' });
  const emails = sent.filter(s => s.url.includes('resend.com'));
  assert.equal(emails.length, 1);
  assert.deepEqual(emails[0].body.to, ['david@alot.land']);
  const all = JSON.stringify(emails[0].body.to);
  assert.ok(!/tony|ryan/i.test(all), 'no agent address anywhere in the recipients');
});

test('the daily report reaches the owner only', async () => {
  const { sendReport } = await import('../notify.mjs?send4');
  await sendReport('nothing outstanding');
  const emails = sent.filter(s => s.url.includes('resend.com'));
  assert.deepEqual(emails[0].body.to, ['david@alot.land']);
});

test('the buyer acknowledgement goes to the buyer, and replies reach a person', async () => {
  const { acknowledgeBuyer } = await import('../notify.mjs?send5');
  await acknowledgeBuyer(lead(), { siteUrl: 'https://alot.land' });
  const e = sent.filter(s => s.url.includes('resend.com'))[0];
  assert.deepEqual(e.body.to, ['dana@example.com']);
  assert.ok(e.body.reply_to, 'a reply must reach a mailbox that exists');
  assert.ok(!/tony|ryan/i.test(JSON.stringify(e.body.to)), 'agents are not copied on buyer mail');
});

test('no SMS is sent while SMS_ENABLED is unset', async () => {
  process.env.LEAD_NOTIFY_SMS = '+17316072221';
  const { notifyAll } = await import('../notify.mjs?send6');
  const attempts = await notifyAll(lead(), { siteUrl: 'https://alot.land' });
  const sms = attempts.find(a => a.channel === 'sms');
  assert.equal(sms.status, 'skipped');
  assert.equal(sent.filter(s => !s.url.includes('resend.com')).length, 0, 'nothing sent to any SMS provider');
});
