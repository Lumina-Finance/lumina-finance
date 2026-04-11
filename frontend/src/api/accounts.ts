import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/contexts/AuthContext';

const API_BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:8000';

export type AccountKind = 'asset' | 'liability';

export type AccountType =
  | 'checking'
  | 'savings'
  | 'term_deposit'
  | 'cash'
  | 'investment'
  | 'credit_card'
  | 'line_of_credit'
  | 'heloc'
  | 'loan'
  | 'mortgage';

export type TaxTreatment = 'taxable' | 'tax_free' | 'tax_deferred' | 'tax_assisted';

export interface Institution {
  id: string;
  status: string;
  name: string;
  country_code: string;
  website: string;
  logo_url: string | null;
}

// Mirrors backend AccountsOverview — one row of the trimmed shape returned
// by GET /accounts. current_balance and credit_limit are integers in currency
// minor units.
export interface AccountsOverview {
  id: string;
  owner_id: string | null;
  group_id: string | null;
  account_kind: AccountKind;
  account_type: AccountType;
  tax_treatment: TaxTreatment;
  name: string;
  institution: Institution | null;
  currency: string;
  current_balance: number;
  credit_limit: number | null;
  is_hidden: boolean;
  closed_at: string | null;
}

async function fetchAccounts(accessToken: string): Promise<AccountsOverview[]> {
  const res = await fetch(`${API_BASE}/accounts`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    throw new Error(`Failed to load accounts (${res.status})`);
  }
  return res.json();
}

export function useAccounts() {
  const { accessToken } = useAuth();
  return useQuery({
    queryKey: ['accounts'],
    queryFn: () => fetchAccounts(accessToken!),
    enabled: !!accessToken,
  });
}
