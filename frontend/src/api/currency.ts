import { useQuery } from '@tanstack/react-query';
import { currencyKeys } from '@/api/queryKeys';
import { API_BASE } from './config';

export interface Currency {
  id: string;
  name: string;
  symbol: string;
  minor_unit_exponent: number;
}

/**
 * Fetches static ISO currency metadata used by money inputs and displays
 */
async function fetchCurrencies(): Promise<Currency[]> {
  const res = await fetch(`${API_BASE}/currencies`);
  if (!res.ok) {
    throw new Error(`Failed to load currencies (${res.status})`);
  }
  return res.json();
}

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
