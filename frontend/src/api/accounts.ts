import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import { useAuth } from '@/hooks/useAuth';
import { authenticatedFetch } from '@/api/client';

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

// Mirrors the backend's ACCOUNT_KIND_BY_TYPE mapping. When a user picks an
// account_type, the kind is determined automatically — no separate selector needed.
export const ACCOUNT_KIND_BY_TYPE: Record<AccountType, AccountKind> = {
  checking: 'asset',
  savings: 'asset',
  term_deposit: 'asset',
  cash: 'asset',
  investment: 'asset',
  credit_card: 'liability',
  line_of_credit: 'liability',
  heloc: 'liability',
  loan: 'liability',
  mortgage: 'liability',
};

export interface CreateAccountPayload {
  account_kind: AccountKind;
  account_type: AccountType;
  tax_treatment: TaxTreatment;
  name: string;
  institution_id: string | null;
  currency: string;
  lifetime_contribution_limit: number | null;
  credit_limit: number | null;
  is_hidden: boolean;
}

function createAccount(payload: CreateAccountPayload) {
  return authenticatedFetch<AccountsOverview>('/accounts', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function useCreateAccount() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: createAccount,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['accounts'] });
    },
  });
}

export function useAccounts() {
  const { accessToken } = useAuth();
  return useQuery({
    queryKey: ['accounts'],
    queryFn: () => authenticatedFetch<AccountsOverview[]>('/accounts'),
    enabled: !!accessToken,
    // Refetch on tab focus, but only if the cache is older than 10 minutes
    refetchOnWindowFocus: true,
    staleTime: 10 * 60 * 1000,
  });
}
