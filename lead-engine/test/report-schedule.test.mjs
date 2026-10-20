import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chicagoNow, dailyReport } from '../reconcile.mjs';

test('08:00 Chicago is found correctly in BOTH daylight and standard time', () => {
  // Central Daylight Time (UTC-5): 13:00Z is 08:00 local.
  assert.deepEqual(chicagoNow(new Date('2026-07-15T13:00:00Z')), { date: '2026-07-15', hour: 8 });
  // Central Standard Time (UTC-6): 14:00Z is 08:00 local.
  assert.deepEqual(chicagoNow(new Date('2026-01-15T14:00:00Z')), { date: '2026-01-15', hour: 8 });
  // A fixed UTC cron would be an hour out for half the year — this is why the
  // job runs hourly and checks the local clock instead.
  assert.equal(chicagoNow(new Date('2026-01-15T13:00:00Z')).hour, 7);
  assert.equal(chicagoNow(new Date('2026-07-15T14:00:00Z')).hour, 9);
});

test('the local date rolls over correctly near midnight', () => {
  assert.equal(chicagoNow(new Date('2026-07-16T04:59:00Z')).date, '2026-07-15');
  assert.equal(chicagoNow(new Date('2026-07-16T05:01:00Z')).date, '2026-07-16');
});

const lead = (o = {}) => ({
  id: 'x', name: 'Dana', lot: 'sugar-tree-vista-4-whitetail-view', lotName: 'Whitetail Ridge',
  stage: 'new', createdAt: new Date().toISOString(), history: [], notifications: [],
  attribution: { utm_source: 'facebook' }, ...o,
});
const noExceptions = { unacknowledged: [], overdue: [], notificationsFailed: [],
  notificationsNeverSent: [], unassigned: [], parkedJobs: 0, spamForReview: [] };

test('the report leads with sales, and uses "Needs Attention"', () => {
  const t = dailyReport([lead(), lead({ stage: 'contacted' })], noExceptions, { siteUrl: 'https://alot.land' });
  assert.match(t, /DAILY SALES & LEAD REPORT/);
  assert.match(t, /New inquiries \(24h\):\s+2/);
  assert.match(t, /Contacted:\s+1/);
  assert.match(t, /NEEDS ATTENTION/);
  assert.doesNotMatch(t, /EXCEPTION REPORT/i, 'renamed at the owner’s request');
  assert.match(t, /Nothing outstanding/);
  assert.match(t, /WHERE TODAY'S INQUIRIES CAME FROM[\s\S]*facebook/);
});

test('problems appear under Needs Attention and are never called fine', () => {
  const t = dailyReport([lead()], {
    ...noExceptions,
    unacknowledged: [{ id: 'a1', name: 'Marcus', lot: 'Summit' }],
    notificationsFailed: [{ id: 'b2', name: 'Priya', lot: 'Poplar' }],
    parkedJobs: 2,
  }, { siteUrl: 'https://alot.land' });
  assert.match(t, /Nobody has opened Marcus/);
  assert.match(t, /Notification failed: Priya/);
  assert.match(t, /2 job\(s\) unresolved/);
  assert.doesNotMatch(t, /Nothing outstanding/);
});

test('archived synthetic leads are excluded by the caller, not counted as sales', () => {
  // The sweep filters archived records before building the report; prove the
  // report simply counts what it is given, so that filter is the only policy.
  const t = dailyReport([lead()], noExceptions, { siteUrl: 'https://alot.land' });
  assert.match(t, /Active prospects:\s+1/);
});
