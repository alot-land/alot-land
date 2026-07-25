import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../lib/auth';
import { useOrg } from '../lib/org';
import { listInvites, createInvite, revokeInvite, listMembers, listMarkets } from '../lib/queries';

export default function Settings() {
  const { user } = useAuth();
  const { org, role } = useOrg();
  const qc = useQueryClient();
  const isAdmin = role === 'admin';
  const [email, setEmail] = useState('');
  const [inviteRole, setInviteRole] = useState('member');
  const [err, setErr] = useState('');

  const members = useQuery({ queryKey: ['members', org?.id], queryFn: () => listMembers(org.id), enabled: !!org });
  const invites = useQuery({ queryKey: ['invites', org?.id], queryFn: () => listInvites(org.id), enabled: !!org && isAdmin });
  const markets = useQuery({ queryKey: ['markets', org?.id], queryFn: () => listMarkets(org.id), enabled: !!org });

  async function submitInvite(e) {
    e.preventDefault();
    setErr('');
    try {
      await createInvite(org.id, user.id, { email, role: inviteRole });
      setEmail('');
      qc.invalidateQueries({ queryKey: ['invites', org.id] });
    } catch (e2) {
      setErr(e2.message);
    }
  }

  if (!org) return <div className="p-10 text-center text-muted">Loading…</div>;

  return (
    <div className="max-w-3xl mx-auto px-4 py-8 space-y-8">
      <h1 className="font-display text-2xl font-semibold">Settings</h1>

      <section className="card p-5">
        <h2 className="font-medium mb-3">Organization</h2>
        <div className="text-sm text-ink-2">
          <div><span className="text-muted">Name:</span> {org.name}</div>
          <div><span className="text-muted">Plan:</span> {org.plan} · {org.status}</div>
          <div><span className="text-muted">Your role:</span> {role}</div>
        </div>
      </section>

      <section className="card p-5">
        <h2 className="font-medium mb-3">Members</h2>
        <ul className="text-sm divide-y divide-border">
          {(members.data || []).map((m) => (
            <li key={m.user_id} className="py-2 flex justify-between">
              <span className="font-mono text-xs text-ink-2">{m.user_id === user.id ? 'You' : m.user_id.slice(0, 8)}</span>
              <span className="pill bg-surface-2 text-ink-2">{m.role}</span>
            </li>
          ))}
        </ul>
      </section>

      {isAdmin && (
        <section className="card p-5">
          <h2 className="font-medium mb-3">Invites</h2>
          <form onSubmit={submitInvite} className="flex flex-wrap gap-2 items-end mb-4">
            <div className="flex-1 min-w-[200px]">
              <label className="label">Email</label>
              <input className="input" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="teammate@company.com" />
            </div>
            <div>
              <label className="label">Role</label>
              <select className="input" value={inviteRole} onChange={(e) => setInviteRole(e.target.value)}>
                <option value="member">member</option>
                <option value="admin">admin</option>
              </select>
            </div>
            <button className="btn-primary">Invite</button>
          </form>
          {err && <p className="text-sm text-danger mb-3">{err}</p>}
          <ul className="text-sm divide-y divide-border">
            {(invites.data || []).map((iv) => (
              <li key={iv.id} className="py-2 flex items-center justify-between gap-2">
                <span>{iv.email}</span>
                <span className="pill bg-surface-2 text-ink-2">{iv.role}</span>
                <span className="text-xs text-muted">
                  {iv.accepted_at ? 'accepted' : `pending · expires ${new Date(iv.expires_at).toLocaleDateString()}`}
                </span>
                {!iv.accepted_at && (
                  <button
                    onClick={async () => {
                      await revokeInvite(iv.id);
                      qc.invalidateQueries({ queryKey: ['invites', org.id] });
                    }}
                    className="text-danger text-xs underline"
                  >
                    revoke
                  </button>
                )}
              </li>
            ))}
            {invites.data && invites.data.length === 0 && <li className="py-2 text-muted">No invites yet.</li>}
          </ul>
        </section>
      )}

      <section className="card p-5">
        <h2 className="font-medium mb-3">Markets</h2>
        <p className="text-xs text-muted mb-3">
          Per-market defaults feed smart values into the deal form (STR permit status, tax rate, appreciation).
        </p>
        <table className="w-full text-sm">
          <thead>
            <tr>
              <th className="th">Market</th>
              <th className="th">STR permit</th>
              <th className="th">Tax rate</th>
              <th className="th">Apprec.</th>
            </tr>
          </thead>
          <tbody>
            {(markets.data || []).map((m) => (
              <tr key={m.id}>
                <td className="td">{m.name}</td>
                <td className="td">{m.str_permit_status}</td>
                <td className="td">{m.property_tax_rate != null ? `${(m.property_tax_rate * 100).toFixed(2)}%` : '—'}</td>
                <td className="td">{(m.appreciation_rate * 100).toFixed(1)}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
