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
 * Mint an authorisation. Only ever called by the new-buyer intake path, and
 * only after eligibility passes and the idempotency claim succeeds.
 */
export function authorise({ trigger, submissionId, destinations }) {
  if (trigger !== AGENT_TRIGGER) return null;
  return { [SECRET]: true, trigger, submissionId, destinations, at: new Date().toISOString() };
}

/** The sender's check. Anything not minted above is refused. */
export const isAuthorised = (a) => Boolean(a && a[SECRET] === true && a.trigger === AGENT_TRIGGER);

/**
 * Persistent idempotency, keyed to the submission AND the destination.
 *
 * A replayed Netlify event, a duplicate submission or a partial failure must
 * not produce a second message to the same place. Keyed per destination so a
 * failed SMS can be retried without re-sending the email.
 */
export async function claimDelivery(store, { submissionId, destination }) {
  if (!submissionId) return { claimed: false, reason: 'no submission id — refusing rather than risking a duplicate' };
  const key = `notified:${submissionId}:${destination}`;
  try {
    const prior = await store.getFlag(key);
    if (prior) return { claimed: false, reason: 'already delivered', at: prior.at };
    await store.setFlag(key, { at: new Date().toISOString() });
    return { claimed: true, key };
  } catch (e) {
    // Cannot prove it has not already been sent — do not send.
    return { claimed: false, reason: 'idempotency store unavailable: ' + String(e.message ?? e) };
  }
}
