import { createContext, useContext, useEffect, useSyncExternalStore } from 'react';
import { supabase } from './supabase';

const AuthCtx = createContext({ session: null, user: null, loading: true, generation: 0 });
let snapshot = { session: null, loading: true, generation: 0 };
const listeners = new Set();
const subscribe = (listener) => { listeners.add(listener); return () => listeners.delete(listener); };
const getSnapshot = () => snapshot;

function publish(session) {
  const identityChanged = snapshot.session?.user?.id !== session?.user?.id
    || snapshot.session?.user?.email !== session?.user?.email;
  // Token renewal for the same identity must preserve an in-progress form.
  snapshot = { session, loading: false, generation: snapshot.generation + Number(identityChanged) };
  if (!session) {
    // These preferences contain only IDs, never tenant records.
    for (const key of Object.keys(localStorage)) {
      if (key === 'mfda.activeOrg' || key.startsWith('mfda.activeOrg:')) localStorage.removeItem(key);
    }
  }
  listeners.forEach((listener) => listener());
}

export function AuthProvider({ children }) {
  const state = useSyncExternalStore(subscribe, getSnapshot);
  useEffect(() => {
    let active = true;
    let events = 0;
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      events++;
      if (active) publish(session);
    });
    const ticket = events;
    const version = snapshot.generation;
    supabase.auth.getSession().then(({ data, error }) => {
      // A late startup read must not restore the previous identity.
      if (active && events === ticket && snapshot.generation === version) publish(error ? null : data.session);
    });
    return () => { active = false; sub.subscription.unsubscribe(); };
  }, []);
  useEffect(() => {
    if (!state.session?.expires_at) return;
    const remaining = state.session.expires_at * 1000 - Date.now();
    const timer = setTimeout(() => {
      if (snapshot.session !== state.session) return;
      publish(null);
      void supabase.auth.signOut({ scope: 'local' });
    }, Math.max(0, remaining));
    return () => clearTimeout(timer);
  }, [state]);
  return <AuthCtx.Provider value={{ ...state, user: state.session?.user ?? null }}>{children}</AuthCtx.Provider>;
}

export const useAuth = () => useContext(AuthCtx);
export async function signOut() {
  // Hide private views immediately, even if the logout request fails/delays.
  publish(null);
  await supabase.auth.signOut();
}
