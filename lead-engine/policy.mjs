/**
 * The single authority on whether an agent may be notified.
 *
 * Tony and Ryan are listing agents, not operators. They get one kind of
 * message: a genuine new buyer enquiry on a lot that is actually for sale.
 * Everything else — reminders, reports, diagnostics, retries, records rebuilt
 * by reconciliation — reaches the owner or nobody.
 *
 * FAIL-CLOSED. The sender refuses unless it is handed an authorisation minted
 * here, and this is the only function that mints one. A new caller that forgets
 * to ask therefore sends nothing, which is the safe direction. The previous
 * design failed open: any code that could reach notifyAll() could mail an
 * agent, and reconciliation did exactly that through repairMissing().
 */
import eligible from './eligible-lots.json' with { type: 'json' };
import { isTestLead } from './lead.mjs';

/** The one trigger permitted to reach an agent. */
export const AGENT_TRIGGER = 'new-buyer-intake';

const SECRET = Symbol('agent-notification-authorisation');

export const eligibleLots = () => eligible.lots.map(l => l.slug);

/**
 * Is this an eligible new-buyer enquiry?
 *
 * NOTE ON WHAT THIS CAN AND CANNOT PROVE. These checks establish that a
 * submission is well-formed and plausible: it came from our form, names a lot
 * that is for sale, carries a contact method and consent, and did not trip the
 * spam traps. They do NOT establish that a human sent it, or that the human is
 * a real buyer. A determined person can submit a valid-looking enquiry by hand.
 * Treat "eligible" as "worth a human looking at", never as "verified buyer".
 */
export function assessEligibility(lead, { formName } = {}) {
  const reasons = [];
  if (formName !== 'stv-lead') reasons.push(`form "${formName}" is not the authorised intake form`);
  if (isTestLead(lead)) reasons.push('synthetic test record');
  if (!eligibleLots().includes(lead?.lot)) reasons.push(`lot "${lead?.lot}" is not a currently available Sugar Tree Vista lot`);
  if (!lead?.phone && !lead?.email) reasons.push('no contact method');
  if (!lead?.consent?.given) reasons.push('no consent recorded');
  return { ok: reasons.length === 0, reasons };
}

/**
 * Ask permission to notify the agents on ONE channel.
 *
 * Eligibility, the claim and the authorisation are a single operation on
 * purpose. Previously `authorise()` was exported separately, so any module that
 * imported it could mint a token without passing a single check — the guard was
 * really "only one file calls this", which is a convention, not a mechanism.
 * Now the capability IS the gated operation: there is no way to obtain an
 * authorisation without being eligible and winning the claim.
 *
 * The claim is per CHANNEL, not per "agents". Email and SMS fail independently,
 * so a dead SMS provider must not also suppress the email.
 */
export async function requestAgentNotification(lead, { formName, submissionId, channel, store }) {
  const eligibility = assessEligibility(lead, { formName });
  if (!eligibility.ok) return { ok: false, stage: 'eligibility', reasons: eligibility.reasons };

  if (!submissionId) {
    // Without an id there is nothing to make the claim idempotent against, and
    // a duplicate alert is worse than a late one.
    return { ok: false, stage: 'claim', reasons: ['no submission id'] };
  }
  const key = `notify:${submissionId}:${channel}`;

  let claimed;
  try {
    claimed = await store.createFlagIfAbsent(key, {
      status: 'pending', channel, submissionId, at: new Date().toISOString(),
    });
  } catch (e) {
    // Cannot prove this was not already sent — do not send.
    return { ok: false, stage: 'claim', reasons: ['claim store unavailable: ' + String(e.message ?? e)] };
  }
  if (!claimed) return { ok: false, stage: 'claim', reasons: ['already claimed — replay or concurrent event'] };

  return {
    ok: true,
    key,
    authorisation: { [SECRET]: true, trigger: AGENT_TRIGGER, submissionId, channel,
                     destinations: { email: channel === 'email', sms: channel === 'sms' },
                     at: new Date().toISOString() },
  };
}

/**
 * Record how a claimed delivery actually turned out.
 *
 * The claim is taken BEFORE the provider is called, because that is the only
 * order that prevents a duplicate. The cost is that a failed send leaves a
 * claim behind, which would silently suppress the alert forever. So a failure
 * is written into the claim and surfaced to the owner — never retried to an
 * agent automatically, and never quietly forgotten.
 */
export async function settleDelivery(store, key, outcome) {
  if (!key) return;
  try {
    await store.setFlag(key, { ...outcome, settledAt: new Date().toISOString() });
  } catch { /* the alert already went or did not; losing the receipt changes neither */ }
}

/** Claims that were taken but never confirmed delivered. For the owner. */
export function unresolvedDeliveries(attempts = []) {
  return attempts.filter(a => a.status === 'failed' || a.status === 'refused');
}

/**
 * Claim, send and settle each channel — the whole agent-notification path.
 *
 * This lives here, with the senders INJECTED, for two reasons. It cannot import
 * notify.mjs (which imports this module for isAuthorised), and more importantly
 * the guarantee it carries has to be testable by behaviour. The previous version
 * of this logic sat inline in the Netlify function, where the only way to check
 * it was a regex over the source — and a regex over the source is exactly how
 * the earlier loophole passed its tests while the bug was live.
 *
 * `send` is notifyAgentsOfNewLead; `alertOwner` is notifyOwner. Nothing is ever
 * retried to an agent: a stale alert arriving later is indistinguishable from a
 * fresh buyer, which is worse than no alert at all.
 */
export async function dispatchAgentAlerts(lead, {
  formName, submissionId, siteUrl, store, send, alertOwner, channels = ['email', 'sms'],
} = {}) {
  const attempts = [];

  for (const channel of channels) {
    let req;
    try {
      req = await requestAgentNotification(lead, { formName, submissionId, channel, store });
    } catch (e) {
      req = { ok: false, stage: 'error', reasons: [String(e.message ?? e)] };
    }

    if (!req.ok) {
      attempts.push({ channel, to: '-', at: new Date().toISOString(),
                      status: req.stage === 'eligibility' ? 'skipped' : 'refused',
                      reason: `${req.stage}: ${req.reasons.join('; ')}` });
      continue;
    }

    let outcome;
    try {
      const sent = await send(lead, { siteUrl, authorisation: req.authorisation });
      outcome = sent?.find(a => a.channel === channel) ?? sent?.[0]
        ?? { status: 'failed', error: 'no provider result — check recipient configuration' };
    } catch (e) {
      outcome = { status: 'failed', error: String(e.message ?? e).slice(0, 300) };
    }
    attempts.push({ ...outcome, channel });
    await settleDelivery(store, req.key, { status: outcome.status, detail: outcome.error ?? outcome.reason ?? null });
  }

  // A claim is taken before the provider is called — the only order that stops
  // a duplicate. The cost is that a failure leaves a claim standing, which
  // would suppress this buyer's alert forever. So it goes to David, loudly.
  const broken = attempts.filter(a => a.status === 'failed');
  if (broken.length && alertOwner) {
    try {
      await alertOwner({
        subject: `ACTION NEEDED — agents may not have been alerted: ${lead.name}`,
        text: ['A genuine new buyer enquiry arrived and at least one agent alert did not send.',
               'Nothing is retried automatically — that is deliberate, so a stale alert never',
               'reaches Tony looking like a fresh buyer.', '',
               `${lead.name} · ${lead.phone || lead.email || 'no contact'} · ${lead.lotName || lead.lot}`, '',
               ...broken.map(b => `  ${b.channel}: ${b.error ?? b.reason ?? 'failed'}`), '',
               `The lead is saved and safe: ${siteUrl}/lead/?id=${lead.id}`,
               'Call or text Tony with the details above. There is no resend button',
               'on purpose — nothing reaches an agent without you doing it.'].join('\n'),
      });
    } catch { /* the alert failing must not fail the capture */ }
  }

  return attempts;
}

/** The sender's check. Anything not minted above is refused. */
export const isAuthorised = (a) => Boolean(a && a[SECRET] === true && a.trigger === AGENT_TRIGGER);
