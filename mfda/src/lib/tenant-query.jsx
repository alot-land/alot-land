import { createContext, useContext, useEffect, useLayoutEffect, useMemo, useState } from 'react';
import { QueryClient, QueryClientProvider, useQuery as useBaseQuery, useQueryClient as useBaseClient } from '@tanstack/react-query';
import { useAuth, signOut, getAuthScope } from './auth';
import { useOrg } from './org';
import { createTenantCompletionScope } from './tenant-completion';
export { keepPreviousData } from '@tanstack/react-query';

const Scope = createContext(null);
const Completion = createContext(null);
export function TenantBoundary({ children }) {
  const { user, generation: authGeneration, loading: authLoading } = useAuth();
  const { org, role, generation, loading, getScope } = useOrg();
  if (authLoading || (user && loading)) return <div className="p-10 text-center text-muted">Loading…</div>;
  if (user && !org) return <div className="p-10 text-center">No organization access. <button onClick={signOut}>Sign out</button></div>;
  const scope = ['tenant', user?.id ?? 'anonymous', authGeneration, org?.id ?? null, role, generation];
  const readCurrentScope = () => {
    const auth = getAuthScope(), organization = getScope();
    return auth && organization
      ? ['tenant', auth.userId, auth.generation, organization.orgId, organization.role, organization.generation]
      : null;
  };
  return <TenantQueries key={JSON.stringify(scope)} scope={scope} readCurrentScope={readCurrentScope}>{children}</TenantQueries>;
}
function TenantQueries({ scope, readCurrentScope, children }) {
  const [client] = useState(() => new QueryClient({ defaultOptions: { queries: { refetchOnWindowFocus: false } } }));
  const [completion] = useState(() => createTenantCompletionScope(scope, readCurrentScope));
  useLayoutEffect(() => { completion.activate(); return () => completion.invalidate(); }, [completion]);
  useEffect(() => () => { void client.cancelQueries(); client.clear(); }, [client]);
  return <Scope.Provider value={scope}><Completion.Provider value={completion}><QueryClientProvider client={client}>{children}</QueryClientProvider></Completion.Provider></Scope.Provider>;
}
// Call at initiation; invoke the returned predicate before any visible result.
export function useTenantCompletionGuard() { return useContext(Completion).capture; }
export function useQuery(options) {
  const scope = useContext(Scope);
  return useBaseQuery({ ...options, queryKey: [...scope, ...options.queryKey] });
}
export function useQueryClient() {
  const client = useBaseClient();
  const scope = useContext(Scope);
  const completion = useContext(Completion);
  return useMemo(() => ({
    invalidateQueries: (filters = {}) => completion.capture()() && client.invalidateQueries({ ...filters, queryKey: [...scope, ...(filters.queryKey ?? [])] }),
    setQueryData: (key, updater) => completion.capture()() && client.setQueryData([...scope, ...key], updater),
    setQueriesData: (filters, updater) => completion.capture()() && client.setQueriesData({ ...filters, queryKey: [...scope, ...filters.queryKey] }, updater),
  }), [client, scope, completion]);
}
