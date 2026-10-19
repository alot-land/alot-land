/**
 * Who may see a lead.
 *
 * Authorisation is enforced here, server-side, on every request. The link Tony
 * gets by text grants nothing on its own — it only names which lead to ask for.
 * Possession of the URL is not access.
 *
 * Identity tokens are verified by asking Netlify Identity, rather than trusting
 * anything the browser says. The Identity JWT secret is not exposed to
 * functions, so local verification is not an option; one call per request is
 * cheap at this volume and is not a guess.
 */

const ALLOWED = () => (process.env.LEAD_AGENTS ||
  'david@alot.land,tony.alcott@outlook.com,ryan.schuler216@outlook.com')
  .split(',').map(s => s.trim().toLowerCase()).filter(Boolean);

export function bearer(req) {
  const h = req.headers.get('authorization') || '';
  const [scheme, token] = h.split(' ');
  return scheme === 'Bearer' && token ? token : null;
}

/** @returns {Promise<{ok:true,user:{email:string,id:string}}|{ok:false,status:number,error:string}>} */
export async function authenticate(req, siteUrl) {
  const token = bearer(req);
  if (!token) return { ok: false, status: 401, error: 'Sign in to view this lead.' };

  let user;
  try {
    const res = await fetch(`${siteUrl}/.netlify/identity/user`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return { ok: false, status: 401, error: 'Your session has expired — sign in again.' };
    user = await res.json();
  } catch {
    return { ok: false, status: 503, error: 'Could not verify your sign-in just now.' };
  }

  const email = String(user?.email || '').toLowerCase();
  if (!email) return { ok: false, status: 401, error: 'Your session has expired — sign in again.' };
  if (!ALLOWED().includes(email)) {
    // Deliberately the same shape as "no such lead": someone who is signed in
    // but not authorised learns nothing about which leads exist.
    return { ok: false, status: 403, error: 'This account does not have access.' };
  }
  return { ok: true, user: { email, id: user.id || email } };
}

export const agentName = (email) => ({
  'david@alot.land': 'David',
  'tony.alcott@outlook.com': 'Tony',
  'ryan.schuler216@outlook.com': 'Ryan',
}[String(email).toLowerCase()] || email);
