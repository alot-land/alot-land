import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { QueryClient, QueryClientProvider, useQuery as useBaseQuery, useQueryClient as useBaseClient } from '@tanstack/react-query';
import { useAuth, signOut } from './auth';
import { useOrg } from './org';
export { keepPreviousData } from '@tanstack/react-query';

const Scope = createContext(null);
export function TenantBoundary({ children }) {
  const { user, generation: authGeneration, loading: authLoading } = useAuth();
  const { org, role, generation, loading } = useOrg();
  if (authLoading || (user && loading)) return <div className="p-10 text-center text-muted">Loading…</div>;
  if (user && !org) return <div className="p-10 text-center">No organization access. <button onClick={signOut}>Sign out</button></div>;
  const scope = ['tenant', user?.id ?? 'anonymous', authGeneration, org?.id ?? null, role, generation];
  return <TenantQueries key={JSON.stringify(scope)} scope={scope}>{children}</TenantQueries>;
}
function TenantQueries({ scope, children }) {
  const [client] = useState(() => new QueryClient({ defaultOptions: { queries: { refetchOnWindowFocus: false } } }));
  useEffect(() => () => { void client.cancelQueries(); client.clear(); }, [client]);
  return <Scope.Provider value={scope}><QueryClientProvider client={client}>{children}</QueryClientProvider></Scope.Provider>;
}
export function useQuery(options) {
  const scope = useContext(Scope);
  return useBaseQuery({ ...options, queryKey: [...scope, ...options.queryKey] });
}
export function useQueryClient() {
  const client = useBaseClient();
  const scope = useContext(Scope);
  return useMemo(() => ({
    invalidateQueries: (filters = {}) => client.invalidateQueries({ ...filters, queryKey: [...scope, ...(filters.queryKey ?? [])] }),
    setQueryData: (key, updater) => client.setQueryData([...scope, ...key], updater),
    setQueriesData: (filters, updater) => client.setQueriesData({ ...filters, queryKey: [...scope, ...filters.queryKey] }, updater),
  }), [client, scope]);
}
