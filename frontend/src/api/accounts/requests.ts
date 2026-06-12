import { authenticatedFetch } from '@/api/client';
import { buildQueryString } from '@/api/queryString';
import type {
  Account,
  AccountBalanceSnapshot,
  AccountMonthlyCashFlow,
  AccountSnapshotRange,
  AccountSpendingBreakdown,
  AccountsOverview,
  CreateAccountPayload,
  SpendingRange,
  UpdateAccountPayload,
} from '@/api/accounts/types';

/**
 * Creates one account
 */
export function createAccount(payload: CreateAccountPayload) {
  return authenticatedFetch<AccountsOverview>('/accounts', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

/**
 * Updates mutable account identity, archive, and tax-plan fields
 */
export function updateAccount({
  accountId,
  payload,
}: {
  accountId: string;
  payload: UpdateAccountPayload;
}) {
  return authenticatedFetch<Account>(`/accounts/${accountId}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
}

/**
 * Deletes one account by ID
 */
export function deleteAccount(accountId: string) {
  return authenticatedFetch<void>(`/accounts/${accountId}`, {
    method: 'DELETE',
  });
}

/**
 * Fetches account overview rows for account lists and selectors
 */
export function fetchAccounts() {
  return authenticatedFetch<AccountsOverview[]>('/accounts');
}

/**
 * Fetches one account detail record by ID
 */
export function fetchAccount(accountId: string | undefined) {
  return authenticatedFetch<Account>(`/accounts/${accountId}`);
}

/**
 * Fetches account balance snapshots with optional range and granularity controls
 */
export function fetchAccountSnapshots(
  accountId: string | undefined,
  range: AccountSnapshotRange = {},
) {
  const { fromDate, toDate, granularity = 'day', includeAnchor = false } = range;
  return authenticatedFetch<AccountBalanceSnapshot[]>(
    `/accounts/${accountId}/snapshots${buildQueryString({
      from_date: fromDate,
      to_date: toDate,
      granularity: granularity === 'day' ? undefined : granularity,
      include_anchor: includeAnchor || undefined,
    })}`,
  );
}

/**
 * Fetches account spending breakdown for a backend-defined calendar range
 */
export function fetchAccountSpendingBreakdown(
  accountId: string | undefined,
  range: SpendingRange,
) {
  return authenticatedFetch<AccountSpendingBreakdown>(
    `/accounts/${accountId}/spending-breakdown${buildQueryString({ range })}`,
  );
}

/**
 * Fetches account monthly income and expense totals
 */
export function fetchAccountCashFlow(accountId: string | undefined, months: number = 6) {
  return authenticatedFetch<AccountMonthlyCashFlow[]>(
    `/accounts/${accountId}/cash-flow${buildQueryString({ months })}`,
  );
}
