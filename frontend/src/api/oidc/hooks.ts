import { useQuery } from '@tanstack/react-query';
import { oidcKeys } from '@/api/cache/queryKeys';
import { fetchOidcProviders } from '@/api/oidc/requests';

/**
 * Reads the enabled sign-in providers with session-long caching because the list only
 * changes when the operator reconfigures the server
 */
export function useOidcProviders() {
  return useQuery({
    queryKey: oidcKeys.providers(),
    queryFn: fetchOidcProviders,
    staleTime: Infinity,
    gcTime: Infinity,
  });
}
