import { useQuery } from '@tanstack/react-query';
import { currencyKeys } from '@/api/queryKeys';
import { API_BASE } from './config';

export interface Currency {
  id: string;
  name: string;
  symbol: string;
  minor_unit_exponent: number;
}

async function fetchCurrencies(): Promise<Currency[]> {
  const res = await fetch(`${API_BASE}/currencies`);
  if (!res.ok) {
    throw new Error(`Failed to load currencies (${res.status})`);
  }
  return res.json();
}

// ISO 4217 is effectively static, so the query never goes stale or gets
// garbage collected within a session — the persistent cache handles TTL.
export function useCurrencies() {
  return useQuery({
    queryKey: currencyKeys.list(),
    queryFn: fetchCurrencies,
    staleTime: Infinity,
    gcTime: Infinity,
  });
}
