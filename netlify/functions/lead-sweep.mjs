/**
 * Scheduled sweep: reconcile and record. It sends NOTHING.
 *
 * It used to escalate unacknowledged leads and mail an hourly report to the
 * owner and both agents. Running hourly, that meant three test records produced
 * a stream of reminders to Tony — who is a listing agent, not an operator. An
 * agent who learns that most mail from this system is noise stops opening the
 * one that is a real buyer, which is the only outcome that actually matters.
 *
 * So the policy now, enforced here and in notify.mjs:
 *   · agents are emailed ONLY for a genuine new buyer lead, by
 *     submission-created — never by this function
 *   · this sweep performs no outbound email or SMS of any kind
 *   · the exception report is written to the store for the dashboard to read,
 *     not mailed; if it is ever mailed again it goes to the owner alone, daily
 *   · synthetic test records are purged and can never notify anyone
 *
 * Daily, not hourly: nothing here is urgent, and frequency was half the problem.
 */
import * as store from '../../lead-engine/store.mjs';
import { fetchSubmissions, repairMissing, buildExceptionReport } from '../../lead-engine/reconcile.mjs';
import { isTestLead } from '../../lead-engine/lead.mjs';

export default async () => {
  const siteUrl = (process.env.URL || 'https://alot.land').replace(/\/$/, '');
  const out = { at: new Date().toISOString(), sent: 'nothing — this job never emails or texts' };

  // 1. Purge synthetic records so they cannot be escalated, counted or mailed.
  const leads = await store.listLeads({ limit: 500 }).catch(() => []);
  out.purgedTestLeads = [];
  for (const lead of leads) {
    if (!isTestLead(lead)) continue;
    await store.removeLead(lead.id).catch(() => {});
    out.purgedTestLeads.push({ id: lead.id, name: lead.name });
  }

  // 2. Rebuild anything Netlify accepted that never became a lead. Repair writes
  //    records; notifyAll inside it is a no-op for test records and, for real
  //    ones, is the single authorised new-lead notification.
  const subs = await fetchSubmissions({
    siteId: process.env.SITE_ID || process.env.NETLIFY_SITE_ID,
    token: process.env.NETLIFY_API_TOKEN,
  });
  out.reconciliation = subs.ok
    ? await repairMissing({ submissions: subs.submissions, siteUrl })
    : { skipped: subs.reason };

  // 3. Record what needs attention. Stored, not sent.
  const report = await buildExceptionReport({ siteUrl });
  await store.putReport(report).catch(() => {});
  out.report = {
    unacknowledged: report.unacknowledged.length,
    overdue: report.overdue.length,
    notificationsFailed: report.notificationsFailed.length,
    parkedJobs: report.parkedJobs,
    where: 'readable on the dashboard; not emailed',
  };

  return new Response(JSON.stringify(out, null, 2), {
    status: 200, headers: { 'content-type': 'application/json' },
  });
};

// Daily at 13:00 UTC (08:00 Central). Nothing here is urgent.
export const config = { schedule: '0 13 * * *' };
