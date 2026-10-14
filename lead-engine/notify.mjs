/**
 * Notifications, and the honest accounting of whether they happened.
 *
 * Two deliberate positions:
 *  - Delivery is never *claimed*. We record "accepted by the provider" or the
 *    error. No email or SMS provider can promise receipt, and pretending
 *    otherwise is how a lead quietly rots.
 *  - A failure here never fails the capture. The lead is already stored before
 *    anything is sent; failures are queued for retry and surface in the daily
 *    exception report.
 *
 * Email: Resend if RESEND_API_KEY is set. SMS: only if an SMS provider is
 * explicitly configured AND SMS_ENABLED is "true" — no texts are sent, and no
 * cost incurred, until the owner turns it on.
 */

const env = (k, d = '') => (process.env[k] ?? d).trim();

export const recipients = () => ({
  owner: env('LEAD_NOTIFY_OWNER', 'David@alot.land').split(',').map(s => s.trim()).filter(Boolean),
  agents: env('LEAD_NOTIFY_AGENTS', 'tony.alcott@outlook.com,ryan.schuler216@outlook.com').split(',').map(s => s.trim()).filter(Boolean),
  agentSms: env('LEAD_NOTIFY_SMS', '+17316072221'),
});

export const emailConfigured = () => Boolean(env('RESEND_API_KEY'));
export const smsConfigured = () => env('SMS_ENABLED') === 'true' && Boolean(env('SMS_PROVIDER_URL')) && Boolean(env('SMS_PROVIDER_TOKEN'));

async function sendEmail({ to, subject, text, html, replyTo }) {
  if (!emailConfigured()) return { status: 'skipped', reason: 'RESEND_API_KEY not set' };
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${env('RESEND_API_KEY')}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: env('LEAD_FROM_EMAIL', 'Alot of Land <leads@alot.land>'),
      to, subject, text, ...(html ? { html } : {}), ...(replyTo ? { reply_to: replyTo } : {}),
    }),
  });
  const body = await res.text();
  if (!res.ok) throw new Error(`resend ${res.status}: ${body.slice(0, 200)}`);
  return { status: 'accepted', id: (JSON.parse(body || '{}').id) ?? null };
}

async function sendSms({ to, body }) {
  if (!smsConfigured()) return { status: 'skipped', reason: 'SMS not enabled' };
  const res = await fetch(env('SMS_PROVIDER_URL'), {
    method: 'POST',
    headers: { Authorization: `Bearer ${env('SMS_PROVIDER_TOKEN')}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ to, message: body }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`sms ${res.status}: ${text.slice(0, 200)}`);
  return { status: 'accepted' };
}

const money = v => (v && String(v).trim()) || 'price on request';

export function leadSummary(lead, siteUrl) {
  const t = { details: 'requested property details', showing: 'requested a showing', packet: 'downloaded the buyer packet', question: 'asked a question' }[lead.inquiryType] || 'enquired';
  const src = lead.attribution?.utm_source ? `${lead.attribution.utm_source}${lead.attribution.utm_campaign ? ' / ' + lead.attribution.utm_campaign : ''}` : 'direct';
  return [
    `${lead.name} ${t}.`,
    '',
    `Lot:     ${lead.lotName || lead.lot} (${money(lead.lotPrice)})`,
    `Phone:   ${lead.phone || '—'}`,
    `Email:   ${lead.email || '—'}`,
    `Source:  ${src}`,
    lead.message ? `\nMessage: ${lead.message}` : '',
    '',
    `Open the lead: ${siteUrl}/lead/?id=${lead.id}`,
    '',
    'Opening the link asks you to sign in — buyer details are never in the URL.',
  ].filter(x => x !== null).join('\n');
}

/**
 * Notify everyone. Always resolves; each attempt is recorded with its outcome
 * so nothing can look sent when it was not.
 */
export async function notifyAll(lead, { siteUrl }) {
  const r = recipients();
  const attempts = [];
  const record = async (channel, to, fn) => {
    try {
      const out = await fn();
      attempts.push({ channel, to, at: new Date().toISOString(), status: out.status, ...(out.reason ? { reason: out.reason } : {}) });
    } catch (e) {
      attempts.push({ channel, to, at: new Date().toISOString(), status: 'failed', error: String(e.message ?? e).slice(0, 300) });
    }
  };

  const subject = `New Sugar Tree lead — ${lead.lotName || lead.lot} — ${lead.name}`;
  const text = leadSummary(lead, siteUrl);
  const to = [...r.owner, ...r.agents];
  if (to.length) await record('email', to.join(','), () => sendEmail({ to, subject, text, replyTo: lead.email || undefined }));

  if (r.agentSms) {
    const sms = `New Sugar Tree Vista lead — ${lead.lotName || lead.lot}. ${lead.name} ${lead.inquiryType === 'showing' ? 'requested a showing' : 'requested property details'}. View and respond: ${siteUrl}/lead/?id=${lead.id}`;
    await record('sms', r.agentSms, () => sendSms({ to: r.agentSms, body: sms }));
  }
  return attempts;
}

/** Buyer auto-reply. Says only what is verified; promises nothing. */
export async function acknowledgeBuyer(lead, { siteUrl }) {
  if (!lead.email) return { status: 'skipped', reason: 'no email given' };
  const lot = lead.lotName || lead.lot;
  const text = [
    `Hi ${lead.name.split(/\s+/)[0]},`,
    '',
    `Thanks for your interest in ${lot} at Sugar Tree Vista — ${money(lead.lotPrice)}.`,
    '',
    'Tony Alcott, our listing agent, will be in touch shortly. If you would rather',
    'not wait, call or text him on (731) 607-2221.',
    '',
    `Lot details:     ${siteUrl}/listings/${lead.lot}/`,
    `Information sheet: ${siteUrl}/packet/${lead.lot}/`,
    '',
    'Questions about access, septic suitability, utilities or financing are best',
    'answered for your specific lot — ask Tony and he will get you the documents',
    'that exist for it.',
    '',
    'David A. Stone',
    'Alot of Land LLC',
  ].join('\n');
  try {
    const out = await sendEmail({ to: [lead.email], subject: `Sugar Tree Vista — ${lot}`, text });
    return { ...out, at: new Date().toISOString() };
  } catch (e) {
    return { status: 'failed', error: String(e.message ?? e).slice(0, 300), at: new Date().toISOString() };
  }
}


/** Nobody picked a lead up inside the window — tell the owner, not just the agent. */
export async function escalate(lead, { siteUrl }) {
  const r = recipients();
  const to = [...r.owner, ...r.agents];
  if (!to.length) return { status: 'skipped', reason: 'no recipients' };
  const text = [
    `Nobody has picked this lead up.`,
    '',
    leadSummary(lead, siteUrl),
    '',
    'This is the one-business-hour escalation. Opening the lead and marking it',
    'acknowledged stops these.',
  ].join('\n');
  try {
    return await sendEmail({ to, subject: `UNACKNOWLEDGED — ${lead.name} · ${lead.lotName || lead.lot}`, text });
  } catch (e) {
    return { status: 'failed', error: String(e.message ?? e).slice(0, 300) };
  }
}

/** The daily exception summary. */
export async function sendReport(text) {
  const r = recipients();
  if (!r.owner.length) return { status: 'skipped', reason: 'no owner address' };
  try {
    return await sendEmail({ to: r.owner, subject: 'Sugar Tree leads — daily exception report', text });
  } catch (e) {
    return { status: 'failed', error: String(e.message ?? e).slice(0, 300) };
  }
}
