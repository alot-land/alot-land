/**
 * Hourly health check. Silent unless something needs a person.
 *
 * It CANNOT notify an agent. Not by calling the sender — which refuses without
 * an authorisation only the intake path can mint — and not indirectly, because
 * reconciliation now reports to the owner alone. That indirect route,
 * lead-sweep → repairMissing() → notifyAll(), is what reached Tony before.
 *
 * What it does every hour, quietly:
 *   · purge synthetic records so they cannot be counted or escalated
 *   · reconcile Netlify Forms against the working records
 *   · write health to the store for the dashboard
 *
 * What it sends:
 *   · nothing at all, unless it is 08:00 in Chicago and today's report has not
 *     gone out — then one report, to the owner
 *   · an urgent alert to the owner only, deduplicated by problem signature so
 *     an unchanged fault does not mail daily
 */
import * as store from '../../lead-engine/store.mjs';
import {
  fetchSubmissions, repairMissing, retryFailures,
  buildExceptionReport, dailyReport, chicagoNow,
} from '../../lead-engine/reconcile.mjs';
import { isTestLead } from '../../lead-engine/lead.mjs';
import { notifyOwner, sendReport } from '../../lead-engine/notify.mjs';

const REPORT_HOUR = 8;   // 08:00 America/Chicago, DST handled by chicagoNow()

export default async () => {
  const siteUrl = (process.env.URL || 'https://alot.land').replace(/\/$/, '');
  const now = new Date();
  const local = chicagoNow(now);
  const out = { at: now.toISOString(), chicago: local, agentsNotified: 'never — this job cannot' };

  // 1. Synthetic records: excluded from the working set, never deleted from
  //    Netlify Forms, which keeps the audit evidence intact.
  const leads = await store.listLeads({ limit: 500 }).catch(() => []);
  out.archivedTestLeads = [];
  for (const lead of leads) {
    if (!isTestLead(lead) || lead.archived) continue;
    await store.putLead({ ...lead, archived: true, stage: 'lost',
      history: [...(lead.history ?? []), { at: now.toISOString(), by: 'system', action: 'archived',
        note: 'synthetic test record — excluded from reporting and notification' }] }).catch(() => {});
    out.archivedTestLeads.push(lead.id);
  }

  // 2. Reconcile. Any rebuilt lead notifies the OWNER only, inside repairMissing.
  const subs = await fetchSubmissions({
    siteId: process.env.SITE_ID || process.env.NETLIFY_SITE_ID,
    token: process.env.NETLIFY_API_TOKEN,
  });
  out.reconciliation = subs.ok
    ? await repairMissing({ submissions: subs.submissions, siteUrl })
    : { skipped: subs.reason, healthy: false };

  // 3. Park historical agent notifications rather than retrying them.
  out.retries = await retryFailures();

  // 4. Health, written for the dashboard rather than mailed.
  const working = (await store.listLeads({ limit: 500 }).catch(() => [])).filter(l => !l.archived);
  const exceptions = await buildExceptionReport({ siteUrl, now });
  const health = {
    at: now.toISOString(),
    reconciliationHealthy: subs.ok,
    reconciliationProblem: subs.ok ? null : subs.reason,
    unacknowledged: exceptions.unacknowledged.length,
    overdue: exceptions.overdue.length,
    notificationsFailed: exceptions.notificationsFailed.length,
    parkedJobs: exceptions.parkedJobs,
    leads: working.length,
  };
  await store.putReport({ ...exceptions, health }).catch(() => {});
  out.health = health;

  // 5. Urgent only, owner only, deduplicated so an unchanged fault is not
  //    mailed again tomorrow. A failure is never recorded as success.
  const problems = [];
  if (!subs.ok) problems.push(`reconciliation cannot run: ${subs.reason}`);
  if (exceptions.notificationsFailed.length) problems.push(`${exceptions.notificationsFailed.length} notification(s) failed`);
  out.alert = { sent: false };
  if (problems.length) {
    const signature = 'alert:' + problems.join('|').slice(0, 120);
    const seen = await store.getFlag(signature).catch(() => null);
    if (!seen) {
      const res = await notifyOwner({
        subject: 'Alot Of Land — lead system needs attention',
        text: ['Something is wrong and is not fixing itself:', '', ...problems.map(p => `  · ${p}`), '',
               'No agent has been contacted about this.', '', `${siteUrl}/crm/`].join('\n'),
      }).catch(e => ({ status: 'failed', error: String(e.message ?? e) }));
      await store.setFlag(signature, { at: now.toISOString() }).catch(() => {});
      out.alert = { sent: true, problems, result: res?.status };
    } else {
      out.alert = { sent: false, reason: 'already reported', problems };
    }
  }

  // 6. One report a day, at 08:00 Chicago, owner only, never twice.
  out.dailyReport = { sent: false, reason: `not ${REPORT_HOUR}:00 in Chicago` };
  if (local.hour === REPORT_HOUR) {
    const key = `report:${local.date}`;
    const already = await store.getFlag(key).catch(() => null);
    if (already) {
      out.dailyReport = { sent: false, reason: 'already sent today' };
    } else {
      const text = dailyReport(working, exceptions, { siteUrl, now });
      const res = await sendReport(text).catch(e => ({ status: 'failed', error: String(e.message ?? e) }));
      await store.setFlag(key, { at: now.toISOString(), status: res?.status }).catch(() => {});
      out.dailyReport = { sent: true, to: 'owner only', result: res?.status };
    }
  }

  return new Response(JSON.stringify(out, null, 2), { status: 200, headers: { 'content-type': 'application/json' } });
};

// Hourly, so health checks are frequent and the 08:00 Chicago report lands on
// the right hour in both CST and CDT without a second schedule.
export const config = { schedule: '0 * * * *' };
