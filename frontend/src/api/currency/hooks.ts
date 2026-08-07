import { useQuery } from '@tanstack/react-query';
import { fetchCurrencies } from '@/api/currency/requests';
import { currencyKeys } from '@/api/cache/queryKeys';

/**
 * Reads currencies with session-long caching because ISO 4217 metadata is effectively static
 *
 * This query has to settle, and quickly, because the app renders nothing until it does. Both options
 * below exist for that and are deliberately narrower than the defaults: the shared retry would put a
 * second full timeout in front of the failure, and the shared network mode leaves a query paused
 * rather than failed while the browser reports itself offline, which never settles at all
 */
export function useCurrencies() {
  return useQuery({
    queryKey: currencyKeys.list(),
    queryFn: fetchCurrencies,
    staleTime: Infinity,
    gcTime: Infinity,
    retry: false,
    networkMode: 'always',
  });
}
