import { Routes, Route, Navigate, Link, useLocation } from 'react-router-dom';
import { useAuth, signOut } from './lib/auth';
import { useOrg } from './lib/org';
import { supabaseConfigured } from './lib/supabase';
import SignIn from './pages/SignIn';
import Deals from './pages/Deals';
import OnMarket from './pages/OnMarket';
import OffMarket from './pages/OffMarket';
import Markets from './pages/Markets';
import DealNew from './pages/DealNew';
import DealResults from './pages/DealResults';
import Compare from './pages/Compare';
import Guide from './pages/Guide';
import Settings from './pages/Settings';

function ConfigBanner() {
  if (supabaseConfigured) return null;
  return (
    <div className="bg-danger text-white text-sm px-4 py-2 text-center">
      Supabase is not configured. Copy <code>.env.local.example</code> → <code>.env.local</code> and set
      <code> VITE_SUPABASE_URL</code> / <code>VITE_SUPABASE_ANON_KEY</code>.
    </div>
  );
}

function TopBar() {
  const { user } = useAuth();
  const { org, orgs, setOrg, role } = useOrg();
  const loc = useLocation();
  const nav = [
    ['/markets', 'Markets'],
    ['/on-market', 'On-Market'],
    ['/off-market', 'Off-Market'],
    ['/deals', 'Deals'],
    ['/guide', 'Guide'],
    ['/settings', 'Settings'],
  ];
  return (
    <header className="border-b border-border bg-surface">
      <div className="max-w-6xl mx-auto px-4 h-14 flex items-center gap-4">
        <Link to="/deals" className="font-display text-xl font-semibold tracking-tight">
          MFDA<span className="text-gold">.</span>
        </Link>
        <nav className="flex items-center gap-1 ml-2">
          {nav.map(([to, label]) => (
            <Link
              key={to}
              to={to}
              className={`px-3 py-1.5 rounded-lg text-sm ${
                loc.pathname.startsWith(to) ? 'bg-surface-2 text-ink' : 'text-ink-2 hover:bg-surface-2'
              }`}
            >
              {label}
            </Link>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-3 text-sm">
          {orgs.length > 1 ? (
            <select
              value={org?.id || ''}
              onChange={(e) => setOrg(e.target.value)}
              className="bg-surface border border-border rounded-lg px-2 py-1 text-sm"
            >
              {orgs.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </select>
          ) : (
            <span className="text-muted">{org?.name}</span>
          )}
          {role === 'admin' && <span className="pill bg-gold/20 text-warn">admin</span>}
          <span className="text-muted hidden sm:inline">{user?.email}</span>
          <button onClick={signOut} className="text-ink-2 hover:text-ink underline">
            Sign out
          </button>
        </div>
      </div>
    </header>
  );
}

function Protected({ children }) {
  const { session, loading } = useAuth();
  if (loading) return <div className="p-10 text-center text-muted">Loading…</div>;
  if (!session) return <Navigate to="/signin" replace />;
  return children;
}

function Shell({ children }) {
  return (
    <div className="min-h-full flex flex-col">
      <ConfigBanner />
      <TopBar />
      <main className="flex-1">{children}</main>
    </div>
  );
}

export default function App() {
  const { session } = useAuth();
  return (
    <Routes>
      <Route path="/signin" element={session ? <Navigate to="/deals" replace /> : <SignIn />} />
      <Route
        path="/on-market"
        element={
          <Protected>
            <Shell>
              <OnMarket />
            </Shell>
          </Protected>
        }
      />
      <Route
        path="/markets"
        element={
          <Protected>
            <Shell>
              <Markets />
            </Shell>
          </Protected>
        }
      />
      <Route
        path="/off-market"
        element={
          <Protected>
            <Shell>
              <OffMarket />
            </Shell>
          </Protected>
        }
      />
      <Route
        path="/deals"
        element={
          <Protected>
            <Shell>
              <Deals />
            </Shell>
          </Protected>
        }
      />
      <Route
        path="/deals/new"
        element={
          <Protected>
            <Shell>
              <DealNew />
            </Shell>
          </Protected>
        }
      />
      <Route
        path="/deals/:id"
        element={
          <Protected>
            <Shell>
              <DealResults />
            </Shell>
          </Protected>
        }
      />
      <Route
        path="/deals/:id/compare"
        element={
          <Protected>
            <Shell>
              <Compare />
            </Shell>
          </Protected>
        }
      />
      <Route
        path="/deals/:id/edit"
        element={
          <Protected>
            <Shell>
              <DealNew />
            </Shell>
          </Protected>
        }
      />
      <Route
        path="/guide"
        element={
          <Protected>
            <Shell>
              <Guide />
            </Shell>
          </Protected>
        }
      />
      <Route
        path="/settings"
        element={
          <Protected>
            <Shell>
              <Settings />
            </Shell>
          </Protected>
        }
      />
      <Route path="*" element={<Navigate to="/deals" replace />} />
    </Routes>
  );
}
