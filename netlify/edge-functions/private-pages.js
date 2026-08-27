/**
 * Password gate for the private pages (/seo and /handbook).
 *
 * These are noindex and out of the sitemap, which stops search engines but not
 * people — the URLs were readable by anyone who had them. This makes the server
 * refuse to hand over the content at all, so there is nothing to find.
 *
 * Netlify's built-in password protection is a paid feature and locks the entire
 * site, which would take alot.land down with it. An edge function gates only
 * these paths and runs on any plan.
 *
 * The password lives in the PRIVATE_PAGES_PASSWORD environment variable in
 * Netlify — never in this repo.
 */

const REALM = 'alot.land private pages';

// Compare without leaking how much of the password was correct via timing.
function safeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export default async (request, context) => {
  const expected = Netlify.env.get('PRIVATE_PAGES_PASSWORD');
  const expectedUser = Netlify.env.get('PRIVATE_PAGES_USER') || 'alot';

  // Fail closed. If the password is not configured, lock the page rather than
  // open it — the opposite default publishes the content silently, which is
  // the exact failure this gate exists to prevent.
  if (!expected) {
    return new Response(
      'These pages are locked.\n\n' +
      'Set PRIVATE_PAGES_PASSWORD in Netlify → Site configuration → ' +
      'Environment variables, then redeploy.\n',
      { status: 503, headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' } },
    );
  }

  const [scheme, encoded] = (request.headers.get('authorization') || '').split(' ');

  if (scheme === 'Basic' && encoded) {
    let decoded = '';
    try { decoded = atob(encoded); } catch { /* malformed header — treat as no credentials */ }
    const sep = decoded.indexOf(':');
    if (sep !== -1 &&
        safeEqual(decoded.slice(0, sep), expectedUser) &&
        safeEqual(decoded.slice(sep + 1), expected)) {
      const res = await context.next();
      // Keep the authenticated copy out of any shared cache, and out of the
      // index even if this gate is ever removed.
      res.headers.set('Cache-Control', 'private, no-store, max-age=0');
      res.headers.set('X-Robots-Tag', 'noindex, nofollow, noarchive, nosnippet');
      return res;
    }
  }

  return new Response('Authentication required.\n', {
    status: 401,
    headers: {
      'WWW-Authenticate': `Basic realm="${REALM}", charset="UTF-8"`,
      'content-type': 'text/plain; charset=utf-8',
      'cache-control': 'no-store',
    },
  });
};

export const config = {
  path: ['/seo', '/seo/', '/seo/*', '/handbook', '/handbook/', '/handbook/*'],
};
