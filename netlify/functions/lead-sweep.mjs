/**
 * The scheduled sweep: escalate, retry, reconcile, report.
 *
 * Runs in the deployed environment on Netlify's scheduler, not as a local
 * script — a watchdog that only exists on a laptop is not a watchdog.
 *
 * Order matters: reconcile first so a lead Netlify accepted but we never built
 * exists before we judge whether anyone has acknowledged it.
 */
import * as store from '../../lead-engine/store.mjs';
import { fetchSubmissions, repairMissing, retryFailures, buildExceptionReport, reportToText } from '../../lead-engine/reconcile.mjs';
import { isUnacknowledged } from '../../lead-engine/lead.mjs';
import { escalate, sendReport } from '../../lead-engine/notify.mjs';

export default async () => {
  const siteUrl = (process.env.URL || 'https://alot.land').replace(/\/$/, '');
  const out = { at: new Date().toISOString() };

  // 1. Anything Netlify accepted that never became a lead.
  const subs = await fetchSubmissions({
    siteId: process.env.SITE_ID || process.env.NETLIFY_SITE_ID,
    token: process.env.NETLIFY_API_TOKEN,
  });
  out.reconciliation = subs.ok
    ? await repairMissing({ submissions: subs.submissions, siteUrl })
    : { skipped: subs.reason };

  // 2. Notifications that failed get another go; the rest stay parked.
  out.retries = await retryFailures({ siteUrl });

  // 3. Escalate leads nobody has acknowledged inside one business hour.
  const leads = await store.listLeads({ limit: 500 });
  const stale = leads.filter(l => isUnacknowledged(l) && !l.escalatedAt);
  out.escalated = [];
  for (const lead of stale) {
    const res = await escalate(lead, { siteUrl });
    await store.putLead({ ...lead, escalatedAt: new Date().toISOString(), escalation: res });
    out.escalated.push({ id: lead.id, name: lead.name, result: res.status });
  }

  // 4. The daily note of what is still wrong. Never claims a failure is fine.
  const report = await buildExceptionReport({ siteUrl });
  out.report = { unacknowledged: report.unacknowledged.length, overdue: report.overdue.length,
                 notificationsFailed: report.notificationsFailed.length, parkedJobs: report.parkedJobs };
  if (process.env.LEAD_DAILY_REPORT !== 'off') {
    out.reportSent = await sendReport(reportToText(report));
  }

  return new Response(JSON.stringify(out, null, 2), {
    status: 200, headers: { 'content-type': 'application/json' },
  });
};

// Hourly: escalation is measured in business hours, so it must be able to fire
// inside the working day rather than once at midnight.
export const config = { schedule: '0 * * * *' };
