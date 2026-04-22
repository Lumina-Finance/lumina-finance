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

export type SnapshotGranularity = 'day' | 'week' | 'month' | 'quarter';

interface SnapshotRange {
  fromDate?: string; // ISO date (YYYY-MM-DD)
  toDate?: string;
  granularity?: SnapshotGranularity;
  includeAnchor?: boolean;
}

export function useAccountSnapshots(
  accountId: string | undefined,
  range: SnapshotRange = {},
) {
  const { accessToken } = useAuth();
  const { fromDate, toDate, granularity = 'day', includeAnchor = false } = range;
  return useQuery({
    queryKey: [
      'accounts',
      accountId,
      'snapshots',
      fromDate ?? null,
      toDate ?? null,
      granularity,
      includeAnchor,
    ],
    queryFn: () => {
      const params = new URLSearchParams();
      if (fromDate) params.set('from_date', fromDate);
      if (toDate) params.set('to_date', toDate);
      if (granularity !== 'day') params.set('granularity', granularity);
      if (includeAnchor) params.set('include_anchor', 'true');
      const qs = params.toString();
      return authenticatedFetch<AccountBalanceSnapshot[]>(
        `/accounts/${accountId}/snapshots${qs ? `?${qs}` : ''}`,
      );
    },
    enabled: !!accessToken && !!accountId,
    staleTime: 5 * 60 * 1000,
  });
}

// Calendar period for the spending breakdown endpoint. Backend derives the
// exact date window from this key so the frontend only sends one string.
export type SpendingRange = 'WTD' | 'MTD' | 'QTD' | 'YTD';

// Mirrors backend AccountTopCategory — one row of the top-categories breakdown.
// `total` is a positive minor-unit sum.
export interface AccountTopCategory {
  category_id: string;
  name: string;
  total: number;
}

// Mirrors backend AccountTopMerchant — one row of the top-merchants breakdown.
export interface AccountTopMerchant {
  merchant_id: string;
  name: string;
  total: number;
}

// Mirrors backend AccountSpendingBreakdown — top-5 category/merchant spend for
// a single account over a calendar range.
export interface AccountSpendingBreakdown {
  range: SpendingRange;
  top_categories: AccountTopCategory[];
  top_merchants: AccountTopMerchant[];
  grand_total_spend: number;
  other_categories_count: number;
  other_merchants_count: number;
}

export function useAccountSpendingBreakdown(
  accountId: string | undefined,
  range: SpendingRange,
) {
  const { accessToken } = useAuth();
  return useQuery({
    queryKey: ['accounts', accountId, 'spending-breakdown', range],
    queryFn: () =>
      authenticatedFetch<AccountSpendingBreakdown>(
        `/accounts/${accountId}/spending-breakdown?range=${range}`,
      ),
    enabled: !!accessToken && !!accountId,
    staleTime: 5 * 60 * 1000,
  });
}
