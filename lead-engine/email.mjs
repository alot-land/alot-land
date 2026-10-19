/**
 * Branded HTML email.
 *
 * Built as table-based HTML with inline styles on purpose: Gmail strips <style>
 * blocks, Outlook ignores flexbox, and a layout that only survives in one
 * client is worse than plain text. Every message also ships a plain-text part,
 * because that is what a watch or a screen reader shows.
 *
 * Colours are the site's: ink #0e1a2e, gold #F5B800.
 */

const INK = '#0e1a2e', GOLD = '#F5B800', PAPER = '#f2f4f8', LINE = '#dde3ec', MUTED = '#5b6b85';
const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const shell = ({ site, preheader, accent = GOLD, children }) => `<!doctype html>
<html><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width,initial-scale=1" />
<meta name="x-apple-disable-message-reformatting" /></head>
<body style="margin:0;padding:0;background:${PAPER};">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${esc(preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${PAPER};padding:24px 12px;">
<tr><td align="center">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:14px;overflow:hidden;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">
    <tr><td style="background:${INK};padding:20px 28px;border-bottom:4px solid ${accent};">
      <a href="${site}" style="color:#ffffff;text-decoration:none;font-size:19px;font-weight:700;letter-spacing:-.3px;">
        a<span style="color:${GOLD}">lot</span>.land
      </a>
      <div style="color:#8fa0bb;font-size:11px;letter-spacing:.14em;text-transform:uppercase;margin-top:4px;">Sugar Tree Vista</div>
    </td></tr>
    <tr><td style="padding:28px;">${children}</td></tr>
    <tr><td style="background:${PAPER};padding:18px 28px;border-top:1px solid ${LINE};color:${MUTED};font-size:12px;line-height:1.5;">
      <strong style="color:${INK}">Alot of Land LLC</strong> · Serving Middle Tennessee<br />
      <a href="tel:+16155386878" style="color:${MUTED};">(615) 538-6878</a> ·
      <a href="mailto:David@alot.land" style="color:${MUTED};">David@alot.land</a>
    </td></tr>
  </table>
</td></tr></table></body></html>`;

const button = (href, label, bg = GOLD, fg = INK) =>
  `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:22px 0;"><tr>
   <td style="background:${bg};border-radius:10px;">
   <a href="${href}" style="display:inline-block;padding:14px 26px;color:${fg};text-decoration:none;font-weight:700;font-size:15px;">${esc(label)}</a>
   </td></tr></table>`;

const row = (k, v) => v
  ? `<tr><td style="padding:7px 0;border-bottom:1px solid ${LINE};color:${MUTED};font-size:13px;width:88px;">${esc(k)}</td>
         <td style="padding:7px 0;border-bottom:1px solid ${LINE};color:${INK};font-size:14px;font-weight:600;">${v}</td></tr>`
  : '';

/** Agent alert: who, which lot, and one button to act. */
export function agentAlertHtml(lead, site) {
  const what = { details: 'requested property details', showing: 'requested a showing',
                 packet: 'downloaded the buyer packet', question: 'asked a question' }[lead.inquiryType] || 'enquired';
  const src = lead.attribution?.utm_source
    ? esc(lead.attribution.utm_source) + (lead.attribution.utm_campaign ? ' / ' + esc(lead.attribution.utm_campaign) : '')
    : 'direct';
  return shell({ site, preheader: `${lead.name} ${what} — ${lead.lotName || lead.lot}`, children: `
    <div style="color:${MUTED};font-size:12px;letter-spacing:.12em;text-transform:uppercase;">New lead</div>
    <h1 style="margin:6px 0 2px;font-size:25px;color:${INK};">${esc(lead.name)}</h1>
    <p style="margin:0 0 18px;color:${MUTED};font-size:15px;">${esc(what)}</p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
      ${row('Lot', esc(lead.lotName || lead.lot) + (lead.lotPrice ? ` <span style="color:${MUTED};font-weight:400">${esc(lead.lotPrice)}</span>` : ''))}
      ${row('Phone', lead.phone ? `<a href="tel:${esc(lead.phone)}" style="color:${INK};">${esc(lead.phone)}</a>` : '')}
      ${row('Email', lead.email ? `<a href="mailto:${esc(lead.email)}" style="color:${INK};">${esc(lead.email)}</a>` : '')}
      ${row('Source', src)}
    </table>
    ${lead.message ? `<div style="margin:18px 0 0;padding:14px 16px;background:${PAPER};border-left:3px solid ${GOLD};border-radius:0 8px 8px 0;color:${INK};font-size:14px;line-height:1.55;">${esc(lead.message)}</div>` : ''}
    ${button(`${site}/lead/?id=${lead.id}`, 'Open the lead')}
    <p style="margin:0;color:${MUTED};font-size:12px;line-height:1.5;">
      Opening the link asks you to sign in — buyer details are never in the URL.</p>` });
}

/** Buyer acknowledgment. Warm, specific, and promises nothing unverified. */
export function buyerAckHtml(lead, site) {
  const first = esc((lead.name || '').trim().split(/\s+/)[0] || 'there');
  const lot = esc(lead.lotName || lead.lot);
  return shell({ site, preheader: `Thanks for your interest in ${lot}`, children: `
    <h1 style="margin:0 0 14px;font-size:25px;color:${INK};">Thanks, ${first}.</h1>
    <p style="margin:0 0 16px;color:${INK};font-size:15px;line-height:1.6;">
      We have your enquiry about <strong>${lot}</strong>${lead.lotPrice ? ` — ${esc(lead.lotPrice)}` : ''} at Sugar Tree Vista.</p>
    <p style="margin:0 0 16px;color:${INK};font-size:15px;line-height:1.6;">
      <strong>Tony Alcott</strong>, our listing agent, will be in touch shortly. If you would rather not
      wait, call or text him on <a href="tel:+17316072221" style="color:${INK};font-weight:600;">(731) 607-2221</a>.</p>
    ${button(`${site}/packet/${lead.lot}/`, 'Open the information sheet')}
    <p style="margin:0 0 6px;color:${MUTED};font-size:14px;line-height:1.6;">
      It has the acreage, photos, and the documents worth asking for before you buy.</p>
    <p style="margin:16px 0 0;color:${MUTED};font-size:13px;line-height:1.6;border-top:1px solid ${LINE};padding-top:14px;">
      Questions about access, septic suitability, utilities or financing depend on the specific lot.
      Ask Tony and he will send whatever documents exist for it — we would rather show you the paperwork
      than guess.</p>
    <p style="margin:18px 0 0;color:${INK};font-size:14px;">David A. Stone<br />
      <span style="color:${MUTED};">Alot of Land LLC</span></p>` });
}

/** Escalation: deliberately red, deliberately uncomfortable. */
export function escalationHtml(lead, site) {
  return shell({ site, accent: '#b42318', preheader: `Nobody has picked up ${lead.name}`, children: `
    <div style="color:#b42318;font-size:12px;letter-spacing:.12em;text-transform:uppercase;font-weight:700;">Not acknowledged</div>
    <h1 style="margin:6px 0 10px;font-size:23px;color:${INK};">${esc(lead.name)} is still waiting</h1>
    <p style="margin:0 0 16px;color:${INK};font-size:15px;line-height:1.6;">
      This lead came in over an hour ago (business hours) and nobody has opened it.</p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
      ${row('Lot', esc(lead.lotName || lead.lot))}
      ${row('Phone', lead.phone ? `<a href="tel:${esc(lead.phone)}" style="color:${INK};">${esc(lead.phone)}</a>` : '')}
    </table>
    ${button(`${site}/lead/?id=${lead.id}`, 'Open it now', '#b42318', '#ffffff')}
    <p style="margin:0;color:${MUTED};font-size:12px;">Marking it acknowledged stops these.</p>` });
}

/** Daily exception report — plain text inside a branded shell. */
export function reportHtml(text, site) {
  return shell({ site, preheader: 'Daily lead exception report', children: `
    <h1 style="margin:0 0 14px;font-size:22px;color:${INK};">Daily lead report</h1>
    <pre style="margin:0;padding:16px;background:${PAPER};border-radius:10px;color:${INK};
      font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12.5px;line-height:1.65;
      white-space:pre-wrap;word-break:break-word;">${esc(text)}</pre>` });
}
