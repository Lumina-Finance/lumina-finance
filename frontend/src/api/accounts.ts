import { useQuery, useQueryClient, useMutation, type QueryClient } from '@tanstack/react-query';
import { useAuth } from '@/hooks/useAuth';
import { authenticatedFetch } from '@/api/client';
import {
  accountKeys,
  dashboardKeys,
  taxAdvantagedPlanKeys,
  transactionKeys,
  transactionOverviewKeys,
  userKeys,
} from '@/api/queryKeys';

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
  tax_advantaged_plan_id: string | null;
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
// created_at exposed for the detail view.
export interface Account extends AccountsOverview {
  created_at: string;
}

export interface CreateAccountPayload {
  account_kind: AccountKind;
  account_type: AccountType;
  tax_advantaged_plan_id: string | null;
  name: string;
  institution_id: string | null;
  currency: string;
  credit_limit: number | null;
  is_hidden: boolean;
}

export interface UpdateAccountPayload {
  tax_advantaged_plan_id?: string | null;
  name?: string;
  institution_id?: string | null;
  credit_limit?: number | null;
  is_hidden?: boolean;
  closed_at?: string | null;
}

function createAccount(payload: CreateAccountPayload) {
  return authenticatedFetch<AccountsOverview>('/accounts', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

function updateAccount({ accountId, payload }: { accountId: string; payload: UpdateAccountPayload }) {
  return authenticatedFetch<Account>(`/accounts/${accountId}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
}

function deleteAccount(accountId: string) {
  return authenticatedFetch<void>(`/accounts/${accountId}`, {
    method: 'DELETE',
  });
}

function updateCachedAccountList(queryClient: QueryClient, account: AccountsOverview) {
  queryClient.setQueryData<AccountsOverview[]>(accountKeys.list(), (accounts) => {
    if (!accounts) return [account];
    const index = accounts.findIndex((item) => item.id === account.id);
    if (index === -1) return [...accounts, account];
    return accounts.map((item) => (item.id === account.id ? account : item));
  });
}

function getCachedTaxAdvantagedPlanId(
  queryClient: QueryClient,
  accountId: string,
): string | null | undefined {
  const detail = queryClient.getQueryData<Account>(accountKeys.detail(accountId));
  if (detail) return detail.tax_advantaged_plan_id;

  const accounts = queryClient.getQueryData<AccountsOverview[]>(accountKeys.list());
  return accounts?.find((account) => account.id === accountId)?.tax_advantaged_plan_id;
}

function invalidateTaxAdvantagedPlanCaches(queryClient: QueryClient, planIds: Array<string | null | undefined>) {
  const uniquePlanIds = [...new Set(planIds.filter((planId): planId is string => !!planId))];
  if (uniquePlanIds.length === 0) return;

  queryClient.invalidateQueries({ queryKey: taxAdvantagedPlanKeys.list(), exact: true });
  for (const planId of uniquePlanIds) {
    queryClient.invalidateQueries({ queryKey: taxAdvantagedPlanKeys.detail(planId), exact: true });
  }
}

export function useCreateAccount() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: createAccount,
    onSuccess: (account) => {
      updateCachedAccountList(queryClient, account);
      invalidateTaxAdvantagedPlanCaches(queryClient, [account.tax_advantaged_plan_id]);
    },
  });
}

export function useUpdateAccount() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: updateAccount,
    onSuccess: (account, variables) => {
      const previousPlanId = getCachedTaxAdvantagedPlanId(queryClient, account.id);

      queryClient.setQueryData(accountKeys.detail(account.id), account);
      updateCachedAccountList(queryClient, account);

      if (
        'tax_advantaged_plan_id' in variables.payload
        && previousPlanId !== account.tax_advantaged_plan_id
      ) {
        invalidateTaxAdvantagedPlanCaches(queryClient, [
          previousPlanId,
          account.tax_advantaged_plan_id,
        ]);
      }
    },
  });
}

export function useDeleteAccount() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: deleteAccount,
    onSuccess: (_, accountId) => {
      const previousPlanId = getCachedTaxAdvantagedPlanId(queryClient, accountId);

      queryClient.setQueryData<AccountsOverview[]>(accountKeys.list(), (accounts) =>
        accounts?.filter((account) => account.id !== accountId) ?? accounts,
      );
      queryClient.removeQueries({ queryKey: accountKeys.accountScope(accountId) });
      queryClient.invalidateQueries({ queryKey: transactionKeys.all });
      queryClient.invalidateQueries({ queryKey: transactionOverviewKeys.all });
      queryClient.invalidateQueries({ queryKey: dashboardKeys.all });
      queryClient.invalidateQueries({ queryKey: userKeys.runwayAccounts() });
      queryClient.invalidateQueries({ queryKey: userKeys.runway() });
      invalidateTaxAdvantagedPlanCaches(queryClient, [previousPlanId]);
    },
  });
}

export function useAccounts() {
  const { accessToken } = useAuth();
  return useQuery({
    queryKey: accountKeys.list(),
    queryFn: () => authenticatedFetch<AccountsOverview[]>('/accounts'),
    enabled: !!accessToken,
    staleTime: 10 * 60 * 1000,
  });
}

export function useAccount(accountId: string | undefined) {
  const { accessToken } = useAuth();
  return useQuery({
    queryKey: accountKeys.detail(accountId),
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
    queryKey: accountKeys.snapshots(accountId, {
      fromDate,
      toDate,
      granularity,
      includeAnchor,
    }),
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
    queryKey: accountKeys.spendingBreakdown(accountId, range),
    queryFn: () =>
      authenticatedFetch<AccountSpendingBreakdown>(
        `/accounts/${accountId}/spending-breakdown?range=${range}`,
      ),
    enabled: !!accessToken && !!accountId,
    staleTime: 5 * 60 * 1000,
  });
}

// Mirrors backend MonthlyIncomeExpense — one slot in the monthly cash-flow
// series. `month` is the first-of-month ISO date (YYYY-MM-DD); `income` and
// `expenses` are positive minor units.
export interface AccountMonthlyCashFlow {
  month: string;
  income: number;
  expenses: number;
}

export function useAccountCashFlow(accountId: string | undefined, months: number = 6) {
  const { accessToken } = useAuth();
  return useQuery({
    queryKey: accountKeys.cashFlow(accountId, months),
    queryFn: () =>
      authenticatedFetch<AccountMonthlyCashFlow[]>(
        `/accounts/${accountId}/cash-flow?months=${months}`,
      ),
    enabled: !!accessToken && !!accountId,
    staleTime: 5 * 60 * 1000,
  });
}
