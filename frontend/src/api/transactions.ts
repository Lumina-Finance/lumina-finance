import {
  useInfiniteQuery,
  useQuery,
  useQueryClient,
  useMutation,
  type InfiniteData,
  type QueryClient,
} from '@tanstack/react-query';
import { useAuth } from '@/hooks/useAuth';
import { authenticatedFetch } from '@/api/client';
import {
  invalidateAccountActivity,
  invalidateAccountBalances,
  invalidateAccounts,
  invalidateBudgets,
  invalidateDashboardBalance,
  invalidateDashboardBudgets,
  invalidateDashboardCredit,
  invalidateDashboardIncomeExpense,
  invalidateDashboardRecent,
  invalidateInsightsBalance,
  invalidateInsightsIncomeExpense,
  invalidateInsightsMerchants,
  invalidateRunway,
  invalidateTaxPlans,
  invalidateTransactionOverview as invalidateTransactionOverviewQueries,
  invalidateTransactions,
} from '@/api/cacheInvalidation';
import {
  accountKeys,
  transactionKeys,
  transactionOverviewKeys,
} from '@/api/queryKeys';
import { buildQueryString, type QueryStringValue } from '@/api/queryString';
import type { Account, AccountKind, AccountsOverview } from '@/api/accounts';
import type { FxStatus } from '@/api/dashboard';

// ── Types (mirror backend schemas) ──

export interface Transaction {
  id: string;
  created_by_user_id: string;
  account_id: string;
  // Calendar date in YYYY-MM-DD form (no time, no tz). Backend stores it as a Date column.
  dt: string;
  merchant_id: string | null;
  merchant_name: string | null;
  category_id: string;
  amount: number;
  account_amount: number | null;
  base_currency_amount: number | null;
  currency: string;
  fx_rate: number | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  tag_ids: string[];
  tags: TransactionTag[];
}

export interface TransactionTag {
  id: string;
  group_id: string | null;
  name: string;
}

export interface TopCategorySpend {
  category_id: string;
  category_name: string;
  total: number;
}

export interface DailyCashFlow {
  date: string;
  end_date: string;
  inflow: number;
  outflow: number;
}

export interface OutlierTransaction {
  id: string;
  merchant_name: string | null;
  notes: string | null;
  amount: number;
  currency: string;
  dt: string;
}

export interface TransactionsOverview {
  total_inflow: number | null;
  total_outflow: number | null;
  net_flow_fx_status: FxStatus;
  top_categories: TopCategorySpend[] | null;
  top_categories_fx_status: FxStatus;
  daily_cash_flow: DailyCashFlow[] | null;
  daily_cash_flow_fx_status: FxStatus;
  outliers: OutlierTransaction[] | null;
  outliers_fx_status: FxStatus;
}

export interface TransactionFilters {
  account_id?: string;
  category_id?: string;
  merchant_id?: string;
  currency?: string;
  from_date?: string;
  to_date?: string;
  q?: string;
  sort_by?: 'dt' | 'amount' | 'created_at' | 'updated_at';
  sort_order?: 'asc' | 'desc';
  limit?: number;
  offset?: number;
}

export interface OverviewFilters {
  from_date?: string;
  to_date?: string;
  account_id?: string;
}

export interface CreateTransactionPayload {
  account_id: string;
  // Calendar date in YYYY-MM-DD form.
  dt: string;
  category_id: string;
  amount: number;
  currency: string;
  merchant_id?: string | null;
  fx_rate?: number | null;
  notes?: string | null;
  tag_ids?: string[];
}

export interface UpdateTransactionPayload {
  account_id?: string;
  dt?: string;
  category_id?: string;
  amount?: number;
  merchant_id?: string | null;
  fx_rate?: number | null;
  notes?: string | null;
  tag_ids?: string[];
}

// ── Helpers ──

const TRANSACTION_LIST_FIELDS = new Set<keyof UpdateTransactionPayload>([
  'account_id',
  'dt',
  'category_id',
  'amount',
  'merchant_id',
  'notes',
  'tag_ids',
]);

const TRANSACTION_OVERVIEW_FIELDS = new Set<keyof UpdateTransactionPayload>([
  'account_id',
  'dt',
  'category_id',
  'amount',
  'merchant_id',
  'notes',
]);

const ACCOUNT_BALANCE_FIELDS = new Set<keyof UpdateTransactionPayload>([
  'account_id',
  'dt',
  'amount',
]);

const ACCOUNT_ACTIVITY_FIELDS = new Set<keyof UpdateTransactionPayload>([
  'account_id',
  'dt',
  'category_id',
  'amount',
]);

const DASHBOARD_RECENT_FIELDS = new Set<keyof UpdateTransactionPayload>([
  'account_id',
  'dt',
  'category_id',
  'amount',
  'merchant_id',
]);

const INCOME_EXPENSE_FIELDS = new Set<keyof UpdateTransactionPayload>([
  'account_id',
  'dt',
  'category_id',
  'amount',
]);

const CREDIT_ACTIVITY_FIELDS = new Set<keyof UpdateTransactionPayload>([
  'account_id',
  'amount',
]);

const MERCHANT_ACTIVITY_FIELDS = new Set<keyof UpdateTransactionPayload>([
  'merchant_id',
]);

function delay(ms: number) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

function patchTouches(
  patch: UpdateTransactionPayload,
  fields: Set<keyof UpdateTransactionPayload>,
): boolean {
  return Object.keys(patch).some((key) => fields.has(key as keyof UpdateTransactionPayload));
}

function uniqueIds(ids: Array<string | null | undefined>): string[] {
  return [...new Set(ids.filter((id): id is string => !!id))];
}

function isInfiniteTransactionsData(data: unknown): data is InfiniteData<Transaction[]> {
  return (
    typeof data === 'object'
    && data !== null
    && 'pages' in data
    && Array.isArray((data as InfiniteData<Transaction[]>).pages)
  );
}

function findCachedTransaction(queryClient: QueryClient, transactionId: string): Transaction | undefined {
  const transactionQueries = queryClient.getQueriesData<Transaction[] | InfiniteData<Transaction[]>>({
    queryKey: transactionKeys.all,
    exact: false,
  });

  for (const [, data] of transactionQueries) {
    if (!data) continue;
    if (isInfiniteTransactionsData(data)) {
      const transaction = data.pages.flat().find((item) => item.id === transactionId);
      if (transaction) return transaction;
    } else {
      const transaction = data.find((item) => item.id === transactionId);
      if (transaction) return transaction;
    }
  }
  return undefined;
}

function getCachedAccountPlanId(
  queryClient: QueryClient,
  accountId: string,
): string | null | undefined {
  const detail = queryClient.getQueryData<Account>(accountKeys.detail(accountId));
  if (detail) return detail.tax_advantaged_category_id;

  const accounts = queryClient.getQueryData<AccountsOverview[]>(accountKeys.list());
  return accounts?.find((account) => account.id === accountId)?.tax_advantaged_category_id;
}

function getCachedAccountKind(
  queryClient: QueryClient,
  accountId: string,
): AccountKind | undefined {
  const detail = queryClient.getQueryData<Account>(accountKeys.detail(accountId));
  if (detail) return detail.account_kind;

  const accounts = queryClient.getQueryData<AccountsOverview[]>(accountKeys.list());
  return accounts?.find((account) => account.id === accountId)?.account_kind;
}

interface AccountActivityInvalidationOptions {
  refetchAccountList?: boolean;
}

function invalidateTransactionAccountBalances(queryClient: QueryClient, accountIds: string[]) {
  if (accountIds.length > 0) {
    invalidateAccountBalances(queryClient, accountIds);
    return;
  }

  invalidateAccounts(queryClient);
}

function invalidateTransactionAccountActivity(queryClient: QueryClient, accountIds: string[]) {
  if (accountIds.length > 0) {
    invalidateAccountActivity(queryClient, accountIds);
    return;
  }

  invalidateAccounts(queryClient);
}

function invalidateCreditActivity(queryClient: QueryClient, accountIds: string[]) {
  const mayAffectCredit = accountIds.length === 0
    || accountIds.some((accountId) => {
      const accountKind = getCachedAccountKind(queryClient, accountId);
      return accountKind === undefined || accountKind === 'revolving';
    });

  if (mayAffectCredit) invalidateDashboardCredit(queryClient);
}

function invalidateTaxAdvantagedActivity(queryClient: QueryClient, accountIds: string[]) {
  const planIds = uniqueIds(
    accountIds.map((accountId) => getCachedAccountPlanId(queryClient, accountId)),
  );
  invalidateTaxPlans(queryClient, planIds);
}

export function invalidateTransactionAccountData(
  queryClient: QueryClient,
  accountIds: string[],
  options: AccountActivityInvalidationOptions = {},
) {
  if (options.refetchAccountList) invalidateTransactionAccountBalances(queryClient, accountIds);
  invalidateTransactionAccountActivity(queryClient, accountIds);
  invalidateTaxAdvantagedActivity(queryClient, accountIds);
}

interface FinancialTransactionInvalidationOptions {
  deferAccountInvalidation?: boolean;
}

function invalidateFinancialTransactionData(
  queryClient: QueryClient,
  accountIds: string[],
  options: FinancialTransactionInvalidationOptions = {},
) {
  invalidateTransactionOverviewQueries(queryClient);
  invalidateDashboardBalance(queryClient);
  invalidateDashboardIncomeExpense(queryClient);
  invalidateDashboardRecent(queryClient);
  invalidateInsightsBalance(queryClient);
  invalidateInsightsIncomeExpense(queryClient);
  invalidateBudgets(queryClient);
  invalidateDashboardBudgets(queryClient);
  invalidateRunway(queryClient);
  if (!options.deferAccountInvalidation) {
    invalidateTransactionAccountBalances(queryClient, accountIds);
    invalidateTransactionAccountActivity(queryClient, accountIds);
    invalidateTaxAdvantagedActivity(queryClient, accountIds);
    invalidateCreditActivity(queryClient, accountIds);
  }
}

function invalidatePatchedTransactionData(
  queryClient: QueryClient,
  patch: UpdateTransactionPayload,
  accountIds: string[],
) {
  if (patchTouches(patch, TRANSACTION_LIST_FIELDS)) invalidateTransactions(queryClient);
  if (patchTouches(patch, TRANSACTION_OVERVIEW_FIELDS)) invalidateTransactionOverviewQueries(queryClient);
  if (patchTouches(patch, ACCOUNT_BALANCE_FIELDS)) {
    invalidateTransactionAccountBalances(queryClient, accountIds);
    invalidateDashboardBalance(queryClient);
    invalidateInsightsBalance(queryClient);
  }
  if (patchTouches(patch, ACCOUNT_ACTIVITY_FIELDS)) {
    invalidateTransactionAccountActivity(queryClient, accountIds);
  }
  if (patchTouches(patch, DASHBOARD_RECENT_FIELDS)) invalidateDashboardRecent(queryClient);
  if (patchTouches(patch, INCOME_EXPENSE_FIELDS)) {
    invalidateDashboardIncomeExpense(queryClient);
    invalidateInsightsIncomeExpense(queryClient);
    invalidateBudgets(queryClient);
    invalidateDashboardBudgets(queryClient);
    invalidateRunway(queryClient);
    invalidateTaxAdvantagedActivity(queryClient, accountIds);
  }
  if (patchTouches(patch, CREDIT_ACTIVITY_FIELDS)) invalidateCreditActivity(queryClient, accountIds);
  if (patchTouches(patch, MERCHANT_ACTIVITY_FIELDS)) invalidateInsightsMerchants(queryClient);
}

// ── Hooks ──

export function fetchTransaction(transactionId: string) {
  return authenticatedFetch<Transaction>(`/transactions/${transactionId}`);
}

/**
 * Fetches transactions for a filter set used by transaction lists and selectors
 */
export function fetchTransactions(filters: TransactionFilters = {}) {
  return authenticatedFetch<Transaction[]>(
    '/transactions' + buildQueryString(filters as Record<string, QueryStringValue>),
  );
}

/**
 * Fetches one paginated transaction page while preserving the list filter contract
 */
export function fetchTransactionPage(
  filters: Omit<TransactionFilters, 'limit' | 'offset'> = {},
  pageSize = 15,
  offset = 0,
) {
  return fetchTransactions({
    ...filters,
    limit: pageSize,
    offset,
  });
}

/**
 * Fetches transaction summary data for dashboard and transaction overview cards
 */
export function fetchTransactionsOverview(filters: OverviewFilters = {}) {
  return authenticatedFetch<TransactionsOverview>(
    '/transactions/overview' + buildQueryString(filters as Record<string, QueryStringValue>),
  );
}

export function useTransactions(filters: TransactionFilters = {}) {
  const { accessToken } = useAuth();
  return useQuery({
    queryKey: transactionKeys.list(filters as Record<string, unknown>),
    queryFn: () => fetchTransactions(filters),
    enabled: !!accessToken,
    staleTime: 10 * 60 * 1000,
  });
}

export function useInfiniteTransactions(filters: Omit<TransactionFilters, 'limit' | 'offset'> = {}, pageSize = 15) {
  const { accessToken } = useAuth();
  return useInfiniteQuery({
    queryKey: transactionKeys.infinite(filters as Record<string, unknown>, pageSize),
    queryFn: ({ pageParam }) => fetchTransactionPage(filters, pageSize, pageParam),
    initialPageParam: 0,
    // A short page = end of data
    getNextPageParam: (lastPage, allPages) =>
      lastPage.length < pageSize ? undefined : allPages.length * pageSize,
    enabled: !!accessToken,
    staleTime: 10 * 60 * 1000,
  });
}

export function useTransactionsOverview(filters: OverviewFilters = {}) {
  const { accessToken } = useAuth();
  return useQuery({
    queryKey: transactionOverviewKeys.detail(filters as Record<string, unknown>),
    queryFn: () => fetchTransactionsOverview(filters),
    enabled: !!accessToken,
    staleTime: 10 * 60 * 1000,
  });
}

interface UseCreateTransactionOptions {
  deferAccountInvalidation?: boolean;
}

export function useCreateTransaction({
  deferAccountInvalidation = false,
}: UseCreateTransactionOptions = {}) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: CreateTransactionPayload) =>
      authenticatedFetch<Transaction>('/transactions', {
        method: 'POST',
        body: JSON.stringify(payload),
      }),
    onSuccess: (transaction) => {
      const accountIds = [transaction.account_id];
      invalidateTransactions(queryClient);
      invalidateFinancialTransactionData(queryClient, accountIds, { deferAccountInvalidation });
      invalidateInsightsMerchants(queryClient);
    },
  });
}

export function useUpdateTransaction() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: UpdateTransactionPayload }) =>
      authenticatedFetch<Transaction>(`/transactions/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(patch),
      }),
    onMutate: ({ id }) => ({
      previousTransaction: findCachedTransaction(queryClient, id),
    }),
    onSuccess: (updated, { patch }, context) => {
      const accountIds = uniqueIds([
        context?.previousTransaction?.account_id,
        updated.account_id,
      ]);
      invalidatePatchedTransactionData(queryClient, patch, accountIds);
    },
  });
}

export function useDeleteTransaction({ minimumPendingMs = 0 }: { minimumPendingMs?: number } = {}) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const minimumPending = delay(minimumPendingMs);
      try {
        const result = await authenticatedFetch<void>(`/transactions/${id}`, { method: 'DELETE' });
        await minimumPending;
        return result;
      } catch (error) {
        await minimumPending;
        throw error;
      }
    },
    onMutate: (id) => ({
      deletedTransaction: findCachedTransaction(queryClient, id),
    }),
    onSuccess: (_data, _id, context) => {
      const accountIds = uniqueIds([context?.deletedTransaction?.account_id]);
      invalidateTransactions(queryClient);
      invalidateFinancialTransactionData(queryClient, accountIds);
      invalidateInsightsMerchants(queryClient);
    },
  });
}
