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
  accountKeys,
  budgetKeys,
  categoryKeys,
  dashboardKeys,
  merchantKeys,
  tagKeys,
  taxAdvantagedPlanKeys,
  transactionKeys,
  transactionOverviewKeys,
  userKeys,
} from '@/api/queryKeys';
import type { Account, AccountsOverview } from '@/api/accounts';
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

export interface TransactionImportCreateAccount {
  name: string;
  account_type: Account['account_type'];
  currency: string;
  institution_id?: string | null;
}

export interface TransactionImportAccountMapping {
  source: string;
  account_id?: string | null;
  create?: TransactionImportCreateAccount | null;
}

export interface TransactionImportCreateCategory {
  name: string;
  kind: 'expense' | 'income' | 'transfer';
  icon?: string | null;
}

export interface TransactionImportCategoryMapping {
  source: string;
  category_id?: string | null;
  create?: TransactionImportCreateCategory | null;
}

export interface TransactionImportRow {
  account_source: string;
  category_source: string;
  dt: string;
  amount: string;
  merchant_name?: string | null;
  notes?: string | null;
  tag_names: string[];
}

export interface TransactionImportPayload {
  accounts: TransactionImportAccountMapping[];
  categories: TransactionImportCategoryMapping[];
  rows: TransactionImportRow[];
}

export interface TransactionImportResponse {
  transactions_created: number;
  accounts_created: number;
  accounts_reused: number;
  categories_created: number;
  categories_reused: number;
  merchants_created: number;
  merchants_reused: number;
  tags_created: number;
  tags_reused: number;
  affected_account_ids: string[];
  account_source_ids: Record<string, string>;
  category_source_ids: Record<string, string>;
  created_account_ids: string[];
  created_category_ids: string[];
  created_merchant_ids: string[];
  created_tag_ids: string[];
}

// ── Helpers ──

const ACCOUNT_ACTIVITY_FIELDS = new Set<keyof UpdateTransactionPayload>([
  'account_id',
  'dt',
  'category_id',
  'amount',
  'merchant_id',
]);

const TAX_ADVANTAGED_ACTIVITY_FIELDS = new Set<keyof UpdateTransactionPayload>([
  'account_id',
  'dt',
  'category_id',
  'amount',
]);

const OVERVIEW_INDEPENDENT_FIELDS = new Set<keyof UpdateTransactionPayload>(['tag_ids']);
const MAX_IMPORT_BATCH_BYTES = 750 * 1024;
const TARGET_IMPORT_BATCH_BYTES = 650 * 1024;
const IMPORT_BATCH_YIELD_INTERVAL = 250;
const IMPORT_PAYLOAD_ENCODER = new TextEncoder();

function buildQueryString(params: Record<string, string | number | undefined>): string {
  const entries = Object.entries(params).filter(
    (entry): entry is [string, string | number] => entry[1] !== undefined,
  );
  if (entries.length === 0) return '';
  return '?' + new URLSearchParams(entries.map(([k, v]) => [k, String(v)])).toString();
}

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
  if (detail) return detail.tax_advantaged_plan_id;

  const accounts = queryClient.getQueryData<AccountsOverview[]>(accountKeys.list());
  return accounts?.find((account) => account.id === accountId)?.tax_advantaged_plan_id;
}

function invalidateTransactionLists(queryClient: QueryClient) {
  queryClient.invalidateQueries({ queryKey: transactionKeys.all, exact: false });
}

function invalidateTransactionOverview(queryClient: QueryClient) {
  queryClient.invalidateQueries({ queryKey: transactionOverviewKeys.all, exact: false });
}

interface AccountActivityInvalidationOptions {
  refetchAccountList?: boolean;
}

function invalidateAccountActivity(
  queryClient: QueryClient,
  accountIds: string[],
  options: AccountActivityInvalidationOptions = {},
) {
  if (accountIds.length === 0) return;

  queryClient.invalidateQueries({
    queryKey: accountKeys.list(),
    exact: true,
    refetchType: options.refetchAccountList ? 'active' : 'none',
  });
  for (const accountId of accountIds) {
    queryClient.invalidateQueries({ queryKey: accountKeys.accountScope(accountId), exact: false });
  }
}

function invalidateDashboardActivity(queryClient: QueryClient) {
  queryClient.invalidateQueries({ queryKey: budgetKeys.all, exact: false });
  queryClient.invalidateQueries({ queryKey: dashboardKeys.credit(), exact: true });
  queryClient.invalidateQueries({ queryKey: dashboardKeys.netWorthAll, exact: false });
  queryClient.invalidateQueries({ queryKey: dashboardKeys.savingsRateAll, exact: false });
  queryClient.invalidateQueries({ queryKey: dashboardKeys.recentActivityAll, exact: false });
  queryClient.invalidateQueries({ queryKey: dashboardKeys.spendingComparisonAll, exact: false });
  queryClient.invalidateQueries({ queryKey: dashboardKeys.spendingBreakdownAll, exact: false });
  queryClient.invalidateQueries({ queryKey: userKeys.runway(), exact: true });
}

function invalidateTaxAdvantagedActivity(queryClient: QueryClient, accountIds: string[]) {
  const planIds = uniqueIds(
    accountIds.map((accountId) => getCachedAccountPlanId(queryClient, accountId)),
  );
  if (planIds.length === 0) return;

  queryClient.invalidateQueries({ queryKey: taxAdvantagedPlanKeys.list(), exact: true });
  for (const planId of planIds) {
    queryClient.invalidateQueries({ queryKey: taxAdvantagedPlanKeys.detail(planId), exact: true });
  }
}

export function invalidateTransactionAccountData(
  queryClient: QueryClient,
  accountIds: string[],
  options: AccountActivityInvalidationOptions = {},
) {
  invalidateAccountActivity(queryClient, accountIds, options);
  invalidateTaxAdvantagedActivity(queryClient, accountIds);
}

// ── Hooks ──

export function fetchTransaction(transactionId: string) {
  return authenticatedFetch<Transaction>(`/transactions/${transactionId}`);
}

export function useTransactions(filters: TransactionFilters = {}) {
  const { accessToken } = useAuth();
  return useQuery({
    queryKey: transactionKeys.list(filters as Record<string, unknown>),
    queryFn: () =>
      authenticatedFetch<Transaction[]>(
        '/transactions' + buildQueryString(filters as Record<string, string | number | undefined>),
      ),
    enabled: !!accessToken,
    staleTime: 10 * 60 * 1000,
  });
}

export function useInfiniteTransactions(filters: Omit<TransactionFilters, 'limit' | 'offset'> = {}, pageSize = 15) {
  const { accessToken } = useAuth();
  return useInfiniteQuery({
    queryKey: transactionKeys.infinite(filters as Record<string, unknown>, pageSize),
    queryFn: ({ pageParam }) =>
      authenticatedFetch<Transaction[]>(
        '/transactions' +
          buildQueryString({
            ...(filters as Record<string, string | number | undefined>),
            limit: pageSize,
            offset: pageParam,
          }),
      ),
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
    queryFn: () =>
      authenticatedFetch<TransactionsOverview>(
        '/transactions/overview' + buildQueryString(filters as Record<string, string | number | undefined>),
      ),
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
      invalidateTransactionLists(queryClient);
      invalidateTransactionOverview(queryClient);
      invalidateDashboardActivity(queryClient);
      if (!deferAccountInvalidation) {
        invalidateTransactionAccountData(queryClient, accountIds);
      }
    },
  });
}

async function importTransactionsInBatches(payload: TransactionImportPayload) {
  const accountMappingsBySource = getImportMappingsBySource(payload.accounts);
  const categoryMappingsBySource = getImportMappingsBySource(payload.categories);
  const accountSourceIds: Record<string, string> = {};
  const categorySourceIds: Record<string, string> = {};
  const result = getEmptyImportResponse();
  let rowIndex = 0;

  while (rowIndex < payload.rows.length) {
    const batch = await buildNextImportBatch(
      payload.rows,
      rowIndex,
      accountMappingsBySource,
      categoryMappingsBySource,
      accountSourceIds,
      categorySourceIds,
    );
    const batchPayload = batch.payload;
    rowIndex = batch.nextRowIndex;
    const batchResult = await postTransactionImportBatch(batchPayload);
    mergeImportResponse(result, batchResult);
    Object.assign(accountSourceIds, batchResult.account_source_ids);
    Object.assign(categorySourceIds, batchResult.category_source_ids);
  }

  return result;
}

async function buildNextImportBatch(
  sourceRows: TransactionImportRow[],
  startIndex: number,
  accountMappingsBySource: Map<string, TransactionImportAccountMapping>,
  categoryMappingsBySource: Map<string, TransactionImportCategoryMapping>,
  accountSourceIds: Record<string, string>,
  categorySourceIds: Record<string, string>,
) {
  const rows: TransactionImportRow[] = [];
  const accountSources = new Set<string>();
  const categorySources = new Set<string>();
  let estimatedBytes = getEmptyImportPayloadByteSize();
  let rowIndex = startIndex;

  while (rowIndex < sourceRows.length) {
    const row = sourceRows[rowIndex];
    const nextEstimatedBytes = estimatedBytes
      + getNextArrayItemByteSize(rows.length, row)
      + getNextAccountMappingByteSize(row.account_source, accountSources, accountMappingsBySource, accountSourceIds)
      + getNextCategoryMappingByteSize(row.category_source, categorySources, categoryMappingsBySource, categorySourceIds);

    if (rows.length > 0 && nextEstimatedBytes > TARGET_IMPORT_BATCH_BYTES) break;
    if (rows.length === 0 && nextEstimatedBytes > MAX_IMPORT_BATCH_BYTES) {
      throw new Error('One imported row is too large to upload safely.');
    }

    rows.push(row);
    accountSources.add(row.account_source);
    categorySources.add(row.category_source);
    estimatedBytes = nextEstimatedBytes;
    rowIndex += 1;

    if ((rowIndex - startIndex) % IMPORT_BATCH_YIELD_INTERVAL === 0) {
      await yieldToBrowser();
    }
  }

  if (rows.length === 0) throw new Error('No import rows are available to upload.');

  return {
    payload: buildImportBatchPayload(
      rows,
      [...accountSources],
      [...categorySources],
      accountMappingsBySource,
      categoryMappingsBySource,
      accountSourceIds,
      categorySourceIds,
    ),
    nextRowIndex: rowIndex,
  };
}

function postTransactionImportBatch(payload: TransactionImportPayload) {
  return authenticatedFetch<TransactionImportResponse>('/transactions/import', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

function buildImportBatchPayload(
  rows: TransactionImportRow[],
  accountSources: string[],
  categorySources: string[],
  accountMappingsBySource: Map<string, TransactionImportAccountMapping>,
  categoryMappingsBySource: Map<string, TransactionImportCategoryMapping>,
  accountSourceIds: Record<string, string>,
  categorySourceIds: Record<string, string>,
): TransactionImportPayload {
  return {
    accounts: accountSources.map((source) =>
      getBatchAccountMapping(source, accountMappingsBySource, accountSourceIds),
    ),
    categories: categorySources.map((source) =>
      getBatchCategoryMapping(source, categoryMappingsBySource, categorySourceIds),
    ),
    rows,
  };
}

function getBatchAccountMapping(
  source: string,
  mappingsBySource: Map<string, TransactionImportAccountMapping>,
  sourceIds: Record<string, string>,
): TransactionImportAccountMapping {
  const accountId = sourceIds[source];
  if (accountId) return { source, account_id: accountId };

  const mapping = mappingsBySource.get(source);
  if (!mapping) throw new Error(`Account source is not mapped: ${source}`);
  return mapping;
}

function getBatchCategoryMapping(
  source: string,
  mappingsBySource: Map<string, TransactionImportCategoryMapping>,
  sourceIds: Record<string, string>,
): TransactionImportCategoryMapping {
  const categoryId = sourceIds[source];
  if (categoryId) return { source, category_id: categoryId };

  const mapping = mappingsBySource.get(source);
  if (!mapping) throw new Error(`Category source is not mapped: ${source}`);
  return mapping;
}

function getImportMappingsBySource<T extends { source: string }>(mappings: T[]) {
  return new Map(mappings.map((mapping) => [mapping.source, mapping]));
}

function getNextAccountMappingByteSize(
  source: string,
  sources: Set<string>,
  mappingsBySource: Map<string, TransactionImportAccountMapping>,
  sourceIds: Record<string, string>,
) {
  if (sources.has(source)) return 0;
  return getNextArrayItemByteSize(sources.size, getBatchAccountMapping(source, mappingsBySource, sourceIds));
}

function getNextCategoryMappingByteSize(
  source: string,
  sources: Set<string>,
  mappingsBySource: Map<string, TransactionImportCategoryMapping>,
  sourceIds: Record<string, string>,
) {
  if (sources.has(source)) return 0;
  return getNextArrayItemByteSize(sources.size, getBatchCategoryMapping(source, mappingsBySource, sourceIds));
}

function getNextArrayItemByteSize(currentLength: number, value: unknown) {
  return getJsonByteSize(value) + (currentLength > 0 ? 1 : 0);
}

function getEmptyImportPayloadByteSize() {
  return getJsonByteSize({ accounts: [], categories: [], rows: [] });
}

function yieldToBrowser() {
  return new Promise<void>((resolve) => window.setTimeout(resolve, 0));
}

function getJsonByteSize(value: unknown) {
  return IMPORT_PAYLOAD_ENCODER.encode(JSON.stringify(value)).length;
}

function getEmptyImportResponse(): TransactionImportResponse {
  return {
    transactions_created: 0,
    accounts_created: 0,
    accounts_reused: 0,
    categories_created: 0,
    categories_reused: 0,
    merchants_created: 0,
    merchants_reused: 0,
    tags_created: 0,
    tags_reused: 0,
    affected_account_ids: [],
    account_source_ids: {},
    category_source_ids: {},
    created_account_ids: [],
    created_category_ids: [],
    created_merchant_ids: [],
    created_tag_ids: [],
  };
}

function mergeImportResponse(target: TransactionImportResponse, source: TransactionImportResponse) {
  target.transactions_created += source.transactions_created;
  target.accounts_created += source.accounts_created;
  target.accounts_reused += source.accounts_reused;
  target.categories_created += source.categories_created;
  target.categories_reused += source.categories_reused;
  target.merchants_created += source.merchants_created;
  target.merchants_reused += source.merchants_reused;
  target.tags_created += source.tags_created;
  target.tags_reused += source.tags_reused;
  Object.assign(target.account_source_ids, source.account_source_ids);
  Object.assign(target.category_source_ids, source.category_source_ids);
  appendUnique(target.affected_account_ids, source.affected_account_ids);
  appendUnique(target.created_account_ids, source.created_account_ids);
  appendUnique(target.created_category_ids, source.created_category_ids);
  appendUnique(target.created_merchant_ids, source.created_merchant_ids);
  appendUnique(target.created_tag_ids, source.created_tag_ids);
}

function appendUnique(target: string[], source: string[]) {
  for (const value of source) {
    if (!target.includes(value)) target.push(value);
  }
}

export function useImportTransactions() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: importTransactionsInBatches,
    onSuccess: (result) => {
      invalidateTransactionLists(queryClient);
      invalidateTransactionOverview(queryClient);
      invalidateAccountActivity(queryClient, result.affected_account_ids);
      invalidateDashboardActivity(queryClient);
      invalidateTaxAdvantagedActivity(queryClient, result.affected_account_ids);

      if (result.created_account_ids.length > 0) {
        queryClient.invalidateQueries({ queryKey: accountKeys.list(), exact: true });
      }
      if (result.created_category_ids.length > 0) {
        queryClient.invalidateQueries({ queryKey: categoryKeys.list(), exact: true });
      }
      if (result.created_merchant_ids.length > 0) {
        queryClient.invalidateQueries({ queryKey: merchantKeys.all, exact: false });
      }
      if (result.created_tag_ids.length > 0) {
        queryClient.invalidateQueries({ queryKey: tagKeys.all, exact: false });
      }
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
      const overviewChanged = !Object.keys(patch).every((key) =>
        OVERVIEW_INDEPENDENT_FIELDS.has(key as keyof UpdateTransactionPayload),
      );

      invalidateTransactionLists(queryClient);
      if (overviewChanged) {
        invalidateTransactionOverview(queryClient);
        invalidateDashboardActivity(queryClient);
      }
      if (patchTouches(patch, ACCOUNT_ACTIVITY_FIELDS)) {
        invalidateAccountActivity(queryClient, accountIds);
      }
      if (patchTouches(patch, TAX_ADVANTAGED_ACTIVITY_FIELDS)) {
        invalidateTaxAdvantagedActivity(queryClient, accountIds);
      }
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
      invalidateTransactionLists(queryClient);
      invalidateTransactionOverview(queryClient);
      invalidateAccountActivity(queryClient, accountIds);
      invalidateDashboardActivity(queryClient);
      invalidateTaxAdvantagedActivity(queryClient, accountIds);
    },
  });
}
