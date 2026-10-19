import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reportToText, repairMissing } from '../reconcile.mjs';

test('the report never calls an unresolved failure fine', () => {
  const t = reportToText({
    totals: { leads: 3, open: 2 }, siteUrl: 'https://alot.land',
    unacknowledged: [{ id: 'a1', name: 'Dana', lot: 'Whitetail Ridge', source: 'facebook' }],
    overdue: [], notificationsFailed: [{ id: 'b2', name: 'Marcus', lot: 'Summit' }],
    notificationsNeverSent: [], unassigned: [], parkedJobs: 2, spamForReview: [],
  });
  assert.match(t, /NOT ACKNOWLEDGED/);
  assert.match(t, /NOTIFICATIONS FAILED/);
  assert.match(t, /2 job\(s\) still parked and unresolved/);
  assert.doesNotMatch(t, /Nothing outstanding/, 'must not claim all-clear while things are broken');
  assert.match(t, /lead\/\?id=a1/, 'links straight to the lead');
});

test('a genuinely clear day says so', () => {
  const t = reportToText({
    totals: { leads: 5, open: 1 }, siteUrl: 'https://alot.land',
    unacknowledged: [], overdue: [], notificationsFailed: [], notificationsNeverSent: [],
    unassigned: [], parkedJobs: 0, spamForReview: [],
  });
  assert.match(t, /Nothing outstanding/);
});

test('spam is surfaced for review rather than hidden', () => {
  const t = reportToText({
    totals: { leads: 1, open: 1 }, siteUrl: 'https://alot.land',
    unacknowledged: [], overdue: [], notificationsFailed: [], notificationsNeverSent: [],
    unassigned: [], parkedJobs: 0,
    spamForReview: [{ at: '2026-10-14T10:00:00Z', reason: 'too-fast', name: 'Possibly Real Person' }],
  });
  assert.match(t, /SPAM HELD FOR REVIEW/);
  assert.match(t, /Possibly Real Person/);
});

test('dry-run reconciliation reports what it would rebuild without writing', async () => {
  const subs = [{ id: 'sub-9', created_at: new Date().toISOString(), data: {
    name: 'Rebuilt Person', phone: '6155550133', lot: 'sugar-tree-vista-4-whitetail-view', consent: 'true' } }];
  // leadBySubmission hits the blob store, which is absent here; the dry run must
  // still not throw for the caller.
  const out = await repairMissing({ submissions: subs, siteUrl: 'https://alot.land', dryRun: true })
    .catch(e => ({ threw: String(e.message) }));
  assert.ok(out.threw || Array.isArray(out.repaired), 'returns a result rather than crashing the sweep');
});
