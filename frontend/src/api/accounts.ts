import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import { useAuth } from '@/hooks/useAuth';
import { authenticatedFetch } from '@/api/client';

// Split liabilities into revolving (credit cards, lines of credit, HELOCs —
// purchases already expensed at time of swipe) vs amortizing (loans,
// mortgages — payments are real ongoing cash outflow).
export type AccountKind = 'asset' | 'revolving' | 'amortizing';

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
  credit_card: 'revolving',
  line_of_credit: 'revolving',
  heloc: 'revolving',
  loan: 'amortizing',
  mortgage: 'amortizing',
};

// End-of-day balance record. Backend-maintained — only present for days that
// had activity, so consumers forward-fill between snapshots client-side.
export interface AccountBalanceSnapshot {
  account_id: string;
  balance: number;
  dt: string; // ISO date (YYYY-MM-DD)
}

// Mirrors backend AccountResponse — the full shape returned by GET /accounts/{id},
// POST /accounts, and PATCH /accounts/{id}. Superset of AccountsOverview with
// contribution tallies and limits exposed for the detail view.
export interface Account extends AccountsOverview {
  lifetime_contribution_limit: number | null;
  ytd_contributions: number | null;
  ytd_withdrawals: number | null;
  lifetime_contributions: number | null;
  lifetime_withdrawals: number | null;
  current_year_contribution_limit: number | null;
  current_year_withdrawal_limit: number | null;
  created_at: string;
}

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
    staleTime: 10 * 60 * 1000,
  });
}

export function useAccount(accountId: string | undefined) {
  const { accessToken } = useAuth();
  return useQuery({
    queryKey: ['accounts', accountId],
    queryFn: () => authenticatedFetch<Account>(`/accounts/${accountId}`),
    enabled: !!accessToken && !!accountId,
    staleTime: 10 * 60 * 1000,
  });
}

export function useAccountSnapshots(accountId: string | undefined) {
  const { accessToken } = useAuth();
  return useQuery({
    queryKey: ['accounts', accountId, 'snapshots'],
    queryFn: () =>
      authenticatedFetch<AccountBalanceSnapshot[]>(`/accounts/${accountId}/snapshots`),
    enabled: !!accessToken && !!accountId,
    staleTime: 5 * 60 * 1000,
  });
}
