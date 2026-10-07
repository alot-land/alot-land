import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { useLocation } from 'react-router-dom';
import { supabase } from './supabase';
import { useAuth } from './auth';

const OrgCtx = createContext({ orgs: [], org: null, role: null, loading: true, generation: 0, setOrg: () => {}, refresh: () => {} });

export function OrgProvider({ children }) {
  const { user, generation: authGeneration } = useAuth();
  // The keyed provider prevents old identity loads from ever supplying a new
  // identity's organization/role, even during the first render before effects.
  return <UserOrganizations key={authGeneration} user={user}>{children}</UserOrganizations>;
}

function UserOrganizations({ user, children }) {
  const { pathname } = useLocation();
  const current = useRef({ orgs: [], id: null, loading: !!user, generation: 0 });
  const [state, setState] = useState(current.current);
  function publish(updater) {
    const old = current.current;
    const next = updater(old);
    const oldRole = old.orgs.find((o) => o.id === old.id)?.role;
    const nextRole = next.orgs.find((o) => o.id === next.id)?.role;
    if (old.id !== next.id || oldRole !== nextRole || old.loading !== next.loading) {
      next.generation = Math.max(next.generation, old.generation + 1);
    }
    current.current = next;
    setState(current.current);
  }
  function getScope() {
    const s = current.current;
    const org = s.orgs.find((o) => o.id === s.id);
    return s.loading || !org ? null : { orgId: org.id, role: org.role, generation: s.generation };
  }
  const request = useRef(0);
  const alive = useRef(true);
  const key = `mfda.activeOrg:${user?.id}`;

  async function load({ background = false } = {}) {
    const ticket = ++request.current;
    if (!background) publish((s) => ({ ...s, orgs: [], loading: !!user, generation: s.generation + 1 }));
    if (!user) return;
    try {
      const { error: inviteError } = await supabase.rpc('accept_pending_mfda_invites');
      if (inviteError) throw inviteError;
      const { data, error } = await supabase.from('org_members')
        .select('role, org:orgs(id, name, plan, status)')
        .eq('user_id', user.id).order('created_at', { ascending: true });
      if (error) throw error;
      if (!alive.current || ticket !== request.current) return;
      const orgs = (data || []).filter((r) => r.org).map((r) => ({ ...r.org, role: r.role }));
      const preferred = localStorage.getItem(key);
      const id = orgs.some((o) => o.id === preferred) ? preferred : orgs[0]?.id ?? null;
      publish((s) => ({ ...s, orgs, id, loading: false }));
    } catch {
      if (alive.current && ticket === request.current) publish((s) => ({ ...s, orgs: [], id: null, loading: false }));
    }
  }

  function refresh() {
    // Focus, realtime and explicit refresh discard the view before validation.
    flushSync(() => publish((s) => ({ ...s, orgs: [], loading: true, generation: s.generation + 1 })));
    void load({ background: true });
  }
  useEffect(() => {
    alive.current = true;
    void load();
    return () => { alive.current = false; request.current++; };
  }, [pathname]);
  useEffect(() => {
    if (!user) return;
    const onVisibility = () => { if (document.visibilityState === 'visible') refresh(); };
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', onVisibility);
    // Poll as well: realtime may be unavailable, and deleted membership rows
    // need not be visible through realtime RLS. A failed check fails closed.
    // An unchanged background check preserves forms. A changed organization
    // or role changes the tenant boundary key; a failed check hides the view.
    const timer = setInterval(() => void load({ background: true }), 30000);
    const channel = supabase.channel(`mfda-membership:${user.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'org_members', filter: `user_id=eq.${user.id}` }, refresh)
      .subscribe();
    return () => {
      clearInterval(timer);
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', onVisibility);
      void supabase.removeChannel(channel);
    };
  }, []);

  function setOrg(id) {
    if (id === state.id || !state.orgs.some((o) => o.id === id)) return;
    localStorage.setItem(key, id);
    refresh();
  }
  const org = state.loading ? null : state.orgs.find((o) => o.id === state.id) ?? null;
  return <OrgCtx.Provider value={{ orgs: state.orgs, org, role: org?.role ?? null, loading: state.loading,
    generation: state.generation, setOrg, refresh, getScope }}>{children}</OrgCtx.Provider>;
}
export const useOrg = () => useContext(OrgCtx);
