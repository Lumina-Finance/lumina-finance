import { useQuery } from '@tanstack/react-query';

const API_BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:8000';

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
    queryKey: ['currencies'],
    queryFn: fetchCurrencies,
    staleTime: Infinity,
    gcTime: Infinity,
  });
}
