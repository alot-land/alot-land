// Display formatting only — no financial math lives here (that's @alot/mf-calc).

export function usd(n, opts = {}) {
  if (n == null || !Number.isFinite(n)) return '—';
  const { cents = false } = opts;
  return n.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: cents ? 2 : 0,
    maximumFractionDigits: cents ? 2 : 0,
  });
}

export function pct(n, dp = 2) {
  if (n == null || !Number.isFinite(n)) return '—';
  return `${(n * 100).toFixed(dp)}%`;
}

export function ratio(n, dp = 2) {
  if (n == null) return '—';
  if (!Number.isFinite(n)) return '—';
  return n.toFixed(dp);
}

export function num(n, dp = 0) {
  if (n == null || !Number.isFinite(n)) return '—';
  return n.toLocaleString('en-US', { minimumFractionDigits: dp, maximumFractionDigits: dp });
}
