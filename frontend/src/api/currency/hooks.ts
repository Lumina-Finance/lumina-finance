import { useQuery } from '@tanstack/react-query';
import { fetchCurrencies } from '@/api/currency/requests';
import { currencyKeys } from '@/api/cache/queryKeys';

/**
 * Reads currencies with session-long caching because ISO 4217 metadata is effectively static
 */
export function useCurrencies() {
  return useQuery({
    queryKey: currencyKeys.list(),
    queryFn: fetchCurrencies,
    staleTime: Infinity,
    gcTime: Infinity,
  });
}
