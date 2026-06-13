import { API_BASE } from '@/api/config';
import type { Currency } from '@/api/currency/types';

/**
 * Fetches static ISO currency metadata used by money inputs and displays
 */
export async function fetchCurrencies(): Promise<Currency[]> {
  const res = await fetch(`${API_BASE}/currencies`);
  if (!res.ok) {
    throw new Error(`Failed to load currencies (${res.status})`);
  }
  return res.json();
}
