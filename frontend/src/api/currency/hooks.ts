import { type UseQueryOptions, useQuery } from '@tanstack/react-query';
import type { Currency } from '@/api/currency/types';
import { fetchCurrencies } from '@/api/currency/requests';
import { currencyKeys } from '@/api/cache/queryKeys';

/**
 * How the currency list is fetched and held
 *
 * Exported so a test can assert on these rather than restate them, since a test spelling them out
 * itself would keep passing after someone changed the real ones.
 *
 * The app renders no screen until this query settles, so it has to settle, and quickly. The last five
 * options are what make that true, and each is set here rather than left to the shared default. Three
 * attempts of at most five seconds each, back to back, give a slow server room to answer while
 * bounding the wait at fifteen seconds, where the shared retry allows two and waits between them;
 * the shared network mode leaves the query paused rather than failed while the browser reports
 * itself offline, which never settles at all; retryOnMount would send a query that already failed
 * back to pending whenever the route subtree remounts, which is on most navigations; and a refetch
 * on window focus would do the same when the user came back to the tab. The last of those does follow the shared default
 * today, and is repeated here because the app depends on it and a change made in one place should
 * not quietly reach this
 *
 * The satisfies clause is what keeps a mistyped option name an error. Written inline at the useQuery
 * call the compiler would reject an unknown key on its own, but a shared object is checked loosely
 */
export const currencyQueryOptions = {
  queryKey: currencyKeys.list(),
  queryFn: fetchCurrencies,
  staleTime: Infinity,
  gcTime: Infinity,
  retry: 2,
  retryDelay: 0,
  retryOnMount: false,
  networkMode: 'always',
  refetchOnWindowFocus: false,
} as const satisfies UseQueryOptions<Currency[], Error>;

/**
 * Reads currencies with session-long caching because ISO 4217 metadata is effectively static
 */
export function useCurrencies() {
  return useQuery(currencyQueryOptions);
}
