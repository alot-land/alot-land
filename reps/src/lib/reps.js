// REPS domain model: taxonomy, evidence tiers, and the transparent first-pass
// classifier. Every classification here is a *default* the user overrides in-app.

export const REPS_CATEGORIES = [
  'Acquisitions & Underwriting',
  'Subdivision & Entitlement',
  'Property Management',
  'Direct Mail & Marketing',
  'Investor Relations',
  'Site Visits',
  'Closings & Transactions',
  'Admin',
  'Coaching/Education',
  'Non-REPS',
];

// Evidence strength. The whole point of the app: your defensible floor (STRONG)
// vs your full claimed total (STRONG+MEDIUM+WEAK).
export const TIERS = [
  { key: 'strong', label: 'Strong',  hint: 'Emails, signings, invoices, contemporaneous logs', color: '#3CB054' },
  { key: 'medium', label: 'Medium',  hint: 'Calendar events (documented, not proof of hours worked)', color: '#F5B800' },
  { key: 'weak',   label: 'Weak',    hint: 'Assumed patterns and memory estimates', color: '#B08A4A' },
];
export const tierByKey = Object.fromEntries(TIERS.map((t) => [t.key, t]));
export const TIER_ORDER = { strong: 0, medium: 1, weak: 2 };

export function detectSourceTier(source) {
  const s = (source || '').toLowerCase().trim();
  if (!s) return 'weak';
  if (s === 'context') return 'weak';
  if (s.includes('pattern') || s.includes('memory est')) return 'weak';
  // Bare "FreedomSoft notifications" (no email/invoice) is an assumed pattern.
  if (s.includes('freedomsoft') && !s.includes('email') && !s.includes('invoice')) return 'weak';
  if (s.includes('calendar')) return 'medium';
  return 'strong'; // emails, invoices, signings, bookings, registrations, Time Audit App, agency responses
}

const RE_KW = /(sugar tree|subdivision|subdivide|survey|plat|septic|soil|excavat|driveway|culvert|deed|parcel|acre|lot pin|lot corner|stake|listing|realtor|closing|title|property|signs|landing page)/i;
const SOFTWARE_KW = /(agent|analyzer|\bapp\b|\bapps\b|bookkeeping|triage|automation|\bghl\b|alot\.capital|book|chapter|time audit|netlify)/i;

// Returns the default classification for one raw CSV row.
export function classifyRow({ csvCategory, description, source }) {
  const c = (csvCategory || '').toLowerCase().trim();
  const d = (description || '').toLowerCase();
  const source_tier = detectSourceTier(source);

  // helper to assemble a result
  const R = (category, reps_qualifying, needs_review = false) => ({
    category,
    source_tier,
    is_real_estate: category !== 'Non-REPS' && category !== 'Coaching/Education',
    reps_qualifying,
    needs_review,
  });

  if (c === 'property closing') return R('Closings & Transactions', true);
  if (c === 'property visit') return R('Site Visits', true);
  if (c === 'coaching') return R('Coaching/Education', false, true);
  if (c === 'investor relations') return R('Investor Relations', true);
  if (c === 'team management') return R('Property Management', true);
  if (c === 'business planning') return R('Admin', true);
  if (c === 'disposition') return R('Direct Mail & Marketing', true);

  if (c.startsWith('lead follow')) return R('Acquisitions & Underwriting', true);

  if (c === 'due diligence') {
    return RE_KW.test(d) && /(survey|subdivide|plat|septic|soil|excavat|driveway)/i.test(d)
      ? R('Subdivision & Entitlement', true)
      : R('Acquisitions & Underwriting', true);
  }

  if (c === 'deal negotiation') {
    return /(closing|note|deed|contract|sign|docs|title)/i.test(d)
      ? R('Closings & Transactions', true)
      : R('Acquisitions & Underwriting', true);
  }

  if (c === 'deal management') {
    return /(survey|plat|deed|subdivide|lot|stake|cut plan)/i.test(d)
      ? R('Subdivision & Entitlement', true)
      : R('Closings & Transactions', true);
  }

  if (c === 'networking') {
    if (d.includes('pinnacle')) return R('Non-REPS', false, true); // faith/leadership group
    return R('Investor Relations', true);
  }

  if (c === 'business operations') {
    // Real-property work about an actual property/brand wins over the software signal.
    if (RE_KW.test(d)) {
      if (/(landing page|website|signs|marketing|sign design)/i.test(d)) return R('Direct Mail & Marketing', true, true);
      if (/(survey|subdivide|plat|septic|soil|excavat|driveway|lot)/i.test(d)) return R('Subdivision & Entitlement', true, true);
      return R('Admin', true, true);
    }
    // Building software / writing a book = likely a separate trade or business.
    if (SOFTWARE_KW.test(d) || d.includes('rentals setup')) return R('Non-REPS', false, true);
    // Generic "working on the business" / planning — qualifying by default, but review.
    return R('Admin', true, true);
  }

  // Unknown category — leave for manual review.
  return R('Admin', true, true);
}

// hours -> "6.0h" / "1h 30m" style is handled in the UI; here just format decimal.
export function fmtHours(n) {
  if (!n) return '0.0h';
  return (Math.round(n * 100) / 100).toFixed(n % 1 === 0 ? 1 : 2).replace(/\.00$/, '.0') + 'h';
}

export function pct(part, whole) {
  if (!whole) return 0;
  return (part / whole) * 100;
}

// A stable key for deduping rows on import.
export function dedupeKey(e) {
  return [e.entry_date, (e.description || '').trim().toLowerCase(), e.hours].join('|');
}
