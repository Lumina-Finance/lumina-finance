import { useQuery } from '@tanstack/react-query';
import { oidcKeys } from '@/api/cache/queryKeys';
import { fetchOidcIdentities, fetchOidcProviders } from '@/api/oidc/requests';

/**
 * Reads the enabled sign-in providers with the app's default caching
 *
 * The query cache persists across visits, and the list follows server configuration, so
 * it must stay refetchable or a reconfigured provider set would never reach the login page
 */
export function useOidcProviders() {
  return useQuery({
    queryKey: oidcKeys.providers(),
    queryFn: fetchOidcProviders,
  });
}

/**
 * Reads the account's linked providers for the security settings
 */
export function useOidcIdentities() {
  return useQuery({
    queryKey: oidcKeys.identities(),
    queryFn: fetchOidcIdentities,
  });
}
