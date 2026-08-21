import { Routes, Route, Navigate, NavLink } from 'react-router-dom';
import { useAuth, signOut } from './lib/auth.jsx';
import SignIn from './pages/SignIn.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Entries from './pages/Entries.jsx';
import AddEntry from './pages/AddEntry.jsx';
import Import from './pages/Import.jsx';

const NAV = [
  { to: '/', label: 'Dashboard' },
  { to: '/entries', label: 'Entries' },
  { to: '/add', label: 'Add' },
  { to: '/import', label: 'Import' },
];

export default function App() {
  const { session, loading, user } = useAuth();

  if (loading) {
    return <div className="min-h-screen flex items-center justify-center text-muted animate-pulse">Loading…</div>;
  }
  if (!session) return <SignIn />;

  return (
    <div className="min-h-screen flex flex-col">
      <header className="sticky top-0 z-30 bg-panel/90 backdrop-blur border-b border-border">
        <div className="px-4 sm:px-8 h-14 flex items-center gap-4">
          <div className="flex items-center gap-2.5 shrink-0">
            <img src="/favicon-192.png" alt="" width={26} height={26} className="rounded" />
            <div className="font-display text-lg leading-none">REPS Log</div>
          </div>
          <nav className="flex-1 flex items-center gap-1 overflow-x-auto">
            {NAV.map((n) => (
              <NavLink
                key={n.to}
                to={n.to}
                end={n.to === '/'}
                className={({ isActive }) =>
                  `px-3 py-1.5 rounded-lg text-sm whitespace-nowrap transition ${
                    isActive ? 'bg-panel-2 text-text' : 'text-muted hover:text-text'
                  }`
                }
              >
                {n.label}
              </NavLink>
            ))}
          </nav>
          <div className="hidden sm:flex items-center gap-3 shrink-0">
            <span className="text-[11px] text-muted truncate max-w-[160px]" title={user?.email}>{user?.email}</span>
            <button onClick={signOut} className="text-xs text-muted hover:text-text underline">Sign out</button>
          </div>
        </div>
      </header>

      <main className="flex-1 min-w-0">
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/entries" element={<Entries />} />
          <Route path="/add" element={<AddEntry />} />
          <Route path="/import" element={<Import />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </div>
  );
}
