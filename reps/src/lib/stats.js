import { REPS_CATEGORIES, TIER_ORDER } from './reps';

const inYear = (e, year) => (e.entry_date || '').slice(0, 4) === String(year);

// Cumulative tier sets: strong = strong only; strongMedium = strong+medium;
// all = every tier. Each returns qualifying (750 numerator) and totalWork
// (50%-test denominator = all logged work at that evidence level).
const TIER_SETS = [
  { key: 'strong',       label: 'Strong only',        maxOrder: 0 },
  { key: 'strongMedium', label: 'Strong + Medium',    maxOrder: 1 },
  { key: 'all',          label: 'All (incl. Weak)',   maxOrder: 2 },
];

export function computeStats(entries, year) {
  const rows = entries.filter((e) => inYear(e, year));

  const tiers = TIER_SETS.map((set) => {
    const inSet = rows.filter((e) => (TIER_ORDER[e.source_tier] ?? 2) <= set.maxOrder);
    const qualifying = sum(inSet.filter((e) => e.reps_qualifying).map((e) => e.hours));
    const totalWork = sum(inSet.map((e) => e.hours));
    return {
      ...set,
      qualifyingHours: qualifying,
      totalWorkHours: totalWork,
      pct50: totalWork ? (qualifying / totalWork) * 100 : 0,
      meets750: qualifying >= 750,
      meets50: totalWork > 0 && qualifying / totalWork > 0.5,
    };
  });

  // Category breakdown (qualifying hours, all tiers) with tier composition.
  const byCategory = REPS_CATEGORIES.map((cat) => {
    const catRows = rows.filter((e) => e.category === cat);
    return {
      category: cat,
      hours: sum(catRows.map((e) => e.hours)),
      qualifyingHours: sum(catRows.filter((e) => e.reps_qualifying).map((e) => e.hours)),
      strong: sum(catRows.filter((e) => e.source_tier === 'strong').map((e) => e.hours)),
      medium: sum(catRows.filter((e) => e.source_tier === 'medium').map((e) => e.hours)),
      weak: sum(catRows.filter((e) => e.source_tier === 'weak').map((e) => e.hours)),
    };
  }).filter((c) => c.hours > 0).sort((a, b) => b.hours - a.hours);

  // Days over 10 logged hours (likely bulk-import errors).
  const byDay = {};
  for (const e of rows) byDay[e.entry_date] = (byDay[e.entry_date] || 0) + e.hours;
  const bigDays = Object.entries(byDay)
    .filter(([, h]) => h > 10)
    .map(([date, hours]) => ({ date, hours }))
    .sort((a, b) => b.hours - a.hours);

  const reviewCount = rows.filter((e) => e.needs_review).length;
  const totalHours = sum(rows.map((e) => e.hours));
  const reHours = sum(rows.filter((e) => e.is_real_estate).map((e) => e.hours));
  const nonReHours = totalHours - reHours;

  return {
    year,
    count: rows.length,
    totalHours,
    reHours,
    nonReHours,
    reviewCount,
    tiers,
    byCategory,
    bigDays,
  };
}

function sum(arr) {
  return Math.round(arr.reduce((s, n) => s + (Number(n) || 0), 0) * 100) / 100;
}

export function fmtH(n) {
  return (Math.round((Number(n) || 0) * 10) / 10).toFixed(1);
}
