import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

/**
 * Buyer-facing mail, against a MOCKED provider.
 *
 * The agent-facing rules live in agent-boundary.test.mjs; these cover the one
 * message that goes to the buyer, which has different requirements — it must
 * reach them, must not copy the agents, and must be replyable.
 */
const sent = [];
const realFetch = globalThis.fetch;

beforeEach(() => {
  sent.length = 0;
  process.env.RESEND_API_KEY = 'mock';
  process.env.LEAD_NOTIFY_OWNER = 'david@alot.land';
  process.env.LEAD_NOTIFY_AGENTS = 'tony.alcott@outlook.com,ryan.schuler216@outlook.com';
  globalThis.fetch = async (url, opts) => {
    sent.push({ url: String(url), body: JSON.parse(opts?.body ?? '{}') });
    return new Response(JSON.stringify({ id: 'mock' }), { status: 200 });
  };
});
afterEach(() => { globalThis.fetch = realFetch; delete process.env.RESEND_API_KEY; });

const lead = (over = {}) => ({
  id: 'a'.repeat(32), name: 'Dana Whitfield', phone: '+16155550188', email: 'dana@example.com',
  lot: 'sugar-tree-vista-4-whitetail-view', lotName: 'Whitetail Ridge', lotPrice: '$49,900',
  inquiryType: 'showing', stage: 'new', createdAt: new Date().toISOString(),
  history: [], notifications: [], ...over,
});

test('the buyer is acknowledged, agents are not copied, and a reply reaches a person', async () => {
  const { acknowledgeBuyer } = await import('../notify.mjs?s1');
  await acknowledgeBuyer(lead(), { siteUrl: 'https://alot.land' });
  const e = sent.filter(s => s.url.includes('resend'))[0];
  assert.deepEqual(e.body.to, ['dana@example.com']);
  // The body names Tony on purpose — the buyer is told who will call them.
  // What must not happen is an agent being a RECIPIENT of the buyer's mail.
  const recipients = JSON.stringify([e.body.to, e.body.cc, e.body.bcc]);
  assert.ok(!/tony|ryan/i.test(recipients), 'agents are never recipients of buyer mail');
  assert.match(e.body.text, /Tony Alcott/, 'but the buyer IS told who will contact them');
  assert.ok(e.body.reply_to, 'the from address may be send-only — a reply must land somewhere real');
  assert.ok(e.body.html && e.body.text, 'branded HTML with a text fallback');
});

test('a synthetic record is never acknowledged', async () => {
  const { acknowledgeBuyer } = await import('../notify.mjs?s2');
  const r = await acknowledgeBuyer(lead({ name: 'TEST Log Probe' }), { siteUrl: 'https://alot.land' });
  assert.equal(r.reason, 'test lead');
  assert.equal(sent.length, 0);
});

test('a buyer with no email is skipped rather than erroring', async () => {
  const { acknowledgeBuyer } = await import('../notify.mjs?s3');
  const r = await acknowledgeBuyer(lead({ email: '' }), { siteUrl: 'https://alot.land' });
  assert.equal(r.status, 'skipped');
  assert.equal(sent.length, 0);
});
