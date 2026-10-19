/**
 * Reading and updating leads. Every request is authorised server-side.
 *
 * The secure URL Tony receives by text carries only the lead id — never a
 * token, never buyer details. Opening it asks him to sign in; the id alone
 * grants nothing.
 */
import { authenticate, agentName } from '../../lead-engine/auth.mjs';
import * as store from '../../lead-engine/store.mjs';
import { applyStage, STAGES, STAGE_LABEL, isUnacknowledged, isOverdue } from '../../lead-engine/lead.mjs';

const json = (status, body) => new Response(JSON.stringify(body), {
  status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
});

const siteUrl = () => (process.env.URL || 'https://alot.land').replace(/\/$/, '');

export default async (req) => {
  const auth = await authenticate(req, siteUrl());
  if (!auth.ok) return json(auth.status, { error: auth.error });
  const me = auth.user.email;

  const url = new URL(req.url);

  if (req.method === 'GET') {
    const id = url.searchParams.get('id');
    if (id) {
      const lead = await store.getLead(id);
      if (!lead) return json(404, { error: 'That lead no longer exists.' });
      return json(200, { lead: decorate(lead), me: { email: me, name: agentName(me) }, stages: STAGES, labels: STAGE_LABEL });
    }
    const leads = await store.listLeads({ limit: 200 });
    return json(200, {
      leads: leads.map(l => decorate(l, true)),
      me: { email: me, name: agentName(me) },
      stages: STAGES, labels: STAGE_LABEL,
    });
  }

  if (req.method === 'POST') {
    let body;
    try { body = await req.json(); } catch { return json(400, { error: 'Bad request.' }); }
    const { id, action } = body || {};
    const lead = await store.getLead(id);
    if (!lead) return json(404, { error: 'That lead no longer exists.' });

    const now = new Date();
    let updated;

    if (action === 'stage') {
      if (!STAGES.includes(body.stage)) return json(400, { error: 'Unknown status.' });
      updated = applyStage(lead, { stage: body.stage, by: me, note: String(body.note || '').slice(0, 300), now });
    } else if (action === 'attempt') {
      // A call or email that was *attempted* — explicitly not a conversation.
      // Tapping "call" must never claim the buyer was reached.
      const how = ['called', 'texted', 'emailed'].includes(body.how) ? body.how : 'called';
      const reached = body.reached === true;
      updated = {
        ...lead,
        updatedAt: now.toISOString(),
        history: [...lead.history, {
          at: now.toISOString(), by: me, action: 'attempt', how,
          outcome: reached ? 'reached' : 'no answer',
          ...(body.note ? { note: String(body.note).slice(0, 300) } : {}),
        }],
      };
      // Only an answered conversation advances the stage.
      if (reached && lead.stage === 'new') updated = applyStage(updated, { stage: 'contacted', by: me, now });
      else if (!reached && lead.stage === 'new') updated = applyStage(updated, { stage: 'acknowledged', by: me, note: 'attempted, no answer', now });
    } else if (action === 'note') {
      const note = String(body.note || '').trim().slice(0, 1000);
      if (!note) return json(400, { error: 'Note is empty.' });
      updated = { ...lead, updatedAt: now.toISOString(), history: [...lead.history, { at: now.toISOString(), by: me, action: 'note', note }] };
    } else if (action === 'followup') {
      const when = String(body.when || '').slice(0, 40);
      updated = { ...lead, followUpAt: when || null, updatedAt: now.toISOString(),
        history: [...lead.history, { at: now.toISOString(), by: me, action: 'followup', note: when ? `follow up ${when}` : 'follow-up cleared' }] };
    } else {
      return json(400, { error: 'Unknown action.' });
    }

    await store.putLead(updated);
    return json(200, { lead: decorate(updated), me: { email: me, name: agentName(me) } });
  }

  return json(405, { error: 'Method not allowed' });
};

function decorate(lead, brief = false) {
  const flags = [];
  if (isUnacknowledged(lead)) flags.push('unacknowledged');
  if (isOverdue(lead)) flags.push('overdue');
  const base = {
    id: lead.id, createdAt: lead.createdAt, updatedAt: lead.updatedAt,
    stage: lead.stage, stageLabel: STAGE_LABEL[lead.stage],
    name: lead.name, lot: lead.lot, lotName: lead.lotName, lotPrice: lead.lotPrice,
    inquiryType: lead.inquiryType, assignedTo: lead.assignedTo, flags,
    source: lead.attribution?.utm_source || 'direct',
    campaign: lead.attribution?.utm_campaign || null,
  };
  if (brief) return base;
  return {
    ...base,
    phone: lead.phone, email: lead.email, message: lead.message,
    attribution: lead.attribution, consent: lead.consent,
    notifications: lead.notifications, acknowledgement: lead.acknowledgement,
    followUpAt: lead.followUpAt || null,
    history: lead.history.map(h => ({ ...h, byName: agentName(h.by) })),
    submissionId: lead.submissionId || null,
  };
}

export const config = { path: '/api/lead-admin' };
