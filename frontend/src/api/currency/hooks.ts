import { useQuery } from '@tanstack/react-query';
import { fetchCurrencies } from '@/api/currency/requests';
import { currencyKeys } from '@/api/cache/queryKeys';

/**
 * How the currency list is fetched and held
 *
 * Exported so a test can assert on these rather than restate them, because three of them exist to
 * keep the app out of a state it took five review rounds to stop reaching, and a test that spelled
 * them out itself would keep passing after someone changed the real ones.
 *
 * The app renders no screen until this query settles, so it has to settle and settle quickly. Each
 * option below is deliberately narrower than the shared default: the shared retry would put a second
 * full request timeout in front of the failure, the shared network mode leaves the query paused
 * rather than failed while the browser reports itself offline, which never settles at all, and
 * retryOnMount would send a query that already failed back to pending every time a component
 * remounted, which the navigation sidebar does on every click
 */
export const currencyQueryOptions = {
  queryKey: currencyKeys.list(),
  queryFn: fetchCurrencies,
  staleTime: Infinity,
  gcTime: Infinity,
  retry: false,
  retryOnMount: false,
  networkMode: 'always',
} as const;

/**
 * Reads currencies with session-long caching because ISO 4217 metadata is effectively static
 */
export function useCurrencies() {
  return useQuery(currencyQueryOptions);
}
