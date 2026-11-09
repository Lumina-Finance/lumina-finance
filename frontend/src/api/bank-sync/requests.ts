import { authenticatedFetch } from '@/api/client'
import { REVIEW_PAGE_SIZE } from '@/api/bank-sync/constants'
import type {
  AccountBankStatus,
  AddReviewItemPayload,
  BankAccountLink,
  BankConnection,
  BankHistoryReminder,
  BankImportRange,
  BankLink,
  BankProviderId,
  BankProvidersResponse,
  BankReviewBacklog,
  BankReviewPage,
  BulkApprovalPayload,
  BulkApprovalPreview,
  BulkApprovalResult,
  ClaimCredentialPayload,
  DiscoveredBankAccounts,
  EditableBankField,
  LinkBankAccountPayload,
  BankHold,
  PendingBankTransaction,
  ReconnectConnectionResult,
  UnlinkResult,
} from '@/api/bank-sync/types'
import type { Transaction } from '@/api/transactions/types'
import { buildQueryString } from '@/api/utils/queryString'

// How long a claim or a reconnect may go unanswered. The server answers each only after two requests
// to the provider, claiming the credential and then listing the bank accounts, and lets each take 5
// seconds to resolve the provider's host, 5 to connect and 30 for each wait on the answer, about 80 in
// all for answers that arrive in one piece. The rest covers a host whose first addresses can't be
// reached, since each further one gets its own 5 to connect
const PROVIDER_REQUEST_TIMEOUT_MS = 2 * 60_000

/**
 * Sends a POST with an optional JSON body
 *
 * @param options.timeoutMs - How long to wait for an answer, when it differs from the shared request limit
 * @param options.signal - Aborts the request when the load that asked for it is abandoned
 */
function post<T>(
  path: string,
  body?: unknown,
  { timeoutMs, signal }: { timeoutMs?: number; signal?: AbortSignal } = {},
): Promise<T> {
  return authenticatedFetch<T>(path, {
    method: 'POST',
    body: body === undefined ? undefined : JSON.stringify(body),
    timeoutMs,
    signal,
  })
}

/**
 * Fetches the enabled providers, whether this user may link bank accounts and whether sync is running
 *
 * @param signal - Aborts the request when the load that asked for it is abandoned
 */
export function fetchBankProviders(signal?: AbortSignal) {
  return authenticatedFetch<BankProvidersResponse>('/bank-sync/providers', { signal })
}

/**
 * Fetches the user's connections
 *
 * @param signal - Aborts the request when the load that asked for it is abandoned
 */
export function fetchBankConnections(signal?: AbortSignal) {
  return authenticatedFetch<BankConnection[]>('/bank-sync/connections', { signal })
}

/**
 * Claims the credential the user pasted, storing the access the provider exchanges it for as a new connection
 */
export function claimCredential(payload: ClaimCredentialPayload) {
  return post<BankConnection>('/bank-sync/connections', payload, { timeoutMs: PROVIDER_REQUEST_TIMEOUT_MS })
}

/**
 * Replaces a rejected credential with the access a newly pasted one yields, keeping the connection and
 * the accounts linked through it
 */
export function reconnectBankConnection({
  connectionId,
  credentials,
}: {
  connectionId: string
  credentials: Record<string, string>
}) {
  return post<ReconnectConnectionResult>(
    `/bank-sync/connections/${connectionId}/reconnect`,
    { credentials },
    { timeoutMs: PROVIDER_REQUEST_TIMEOUT_MS },
  )
}

/**
 * Sets a connection's nickname, or clears it with a blank one
 */
export function updateBankConnection({ connectionId, nickname }: { connectionId: string; nickname: string }) {
  return authenticatedFetch<BankConnection>(`/bank-sync/connections/${connectionId}`, {
    method: 'PATCH',
    body: JSON.stringify({ nickname }),
  })
}

/**
 * Stops sync for every account using the connection and deletes its stored credential
 */
export function deleteBankConnection(connectionId: string) {
  return authenticatedFetch<UnlinkResult>(`/bank-sync/connections/${connectionId}`, { method: 'DELETE' })
}

/**
 * Lists the bank accounts a connection returns, described relative to the account being linked
 *
 * @param signal - Aborts the request when the load that asked for it is abandoned
 */
export function fetchDiscoveredBankAccounts(connectionId: string, accountId: string, signal?: AbortSignal) {
  return authenticatedFetch<DiscoveredBankAccounts>(
    `/bank-sync/connections/${connectionId}/accounts` + buildQueryString({ for_account_id: accountId }),
    { signal },
  )
}

/**
 * Fetches every one of the user's links with its status
 *
 * @param signal - Aborts the request when the load that asked for it is abandoned
 */
export function fetchBankLinks(signal?: AbortSignal) {
  return authenticatedFetch<BankLink[]>('/bank-sync/links', { signal })
}

/**
 * Fetches an account's bank link with its status
 *
 * @param signal - Aborts the request when the load that asked for it is abandoned
 */
export function fetchAccountBankStatus(accountId: string, signal?: AbortSignal) {
  return authenticatedFetch<AccountBankStatus>(`/accounts/${accountId}/bank-link`, { signal })
}

/**
 * Fetches where an import into the account may start. That depends on how much history the provider
 * the import would come from allows
 *
 * @param signal - Aborts the request when the load that asked for it is abandoned
 */
export function fetchImportRange(accountId: string, provider: BankProviderId, signal?: AbortSignal) {
  return authenticatedFetch<BankImportRange>(
    `/accounts/${accountId}/bank-link/import-range` + buildQueryString({ provider }),
    { signal },
  )
}

/**
 * Links, or relinks, an account to one bank account and starts its import
 */
export function createBankLink({ account_id: accountId, ...payload }: LinkBankAccountPayload) {
  return post<BankAccountLink>(`/accounts/${accountId}/bank-link`, payload)
}

export function deleteBankLink(accountId: string) {
  return authenticatedFetch<UnlinkResult>(`/accounts/${accountId}/bank-link`, { method: 'DELETE' })
}

/**
 * Asks for a sync of the account's link now. The server refuses it while the request budget is
 * spent or a job covering the link is already running
 */
export function syncBankLink(accountId: string) {
  return post<BankLink>(`/accounts/${accountId}/bank-link/sync`)
}

/**
 * Dismisses the history reminder as it showed, and returns the account's bank link without it. A
 * newer reminder raised meanwhile stays, and the answer carries it
 */
export function dismissHistoryReminder({ accountId, reminder }: { accountId: string; reminder: BankHistoryReminder }) {
  return post<AccountBankStatus>(`/accounts/${accountId}/bank-link/history-reminder/dismiss`, reminder)
}

/**
 * Dismisses the reminder that some of a day's transactions may be missing, and returns the account's
 * bank link without it. A later day raised meanwhile stays, and the answer carries it
 */
export function dismissCutOffDay({ accountId, day }: { accountId: string; day: string }) {
  return post<AccountBankStatus>(`/accounts/${accountId}/bank-link/cut-off-day/dismiss`, { day })
}

/**
 * Records the offered opening adjustment for the amount given, in minor units signed as the ledger
 * keeps them, and returns the account's bank link with no offer left
 */
export function recordOpeningAdjustment({ accountId, amount }: { accountId: string; amount: number }) {
  return post<AccountBankStatus>(`/accounts/${accountId}/bank-link/opening-adjustment/record`, { amount })
}

/**
 * Skips the offered opening adjustment, recording nothing, and returns the account's bank link with
 * no offer left
 */
export function skipOpeningAdjustment(accountId: string) {
  return post<AccountBankStatus>(`/accounts/${accountId}/bank-link/opening-adjustment/skip`)
}

/**
 * Fetches one page of the review inbox, newest first, for some accounts or for all of them
 *
 * @param signal - Aborts the request when the load that asked for it is abandoned
 */
export function fetchReviewPage(
  { accountIds, cursor }: { accountIds?: string[]; cursor?: string | null },
  signal?: AbortSignal,
) {
  return authenticatedFetch<BankReviewPage>(
    '/bank-review/items' +
      buildQueryString({
        account_id: accountIds,
        cursor,
        limit: REVIEW_PAGE_SIZE,
      }),
    { signal },
  )
}

/**
 * Fetches each account's review backlog, for some accounts or for all of them
 *
 * @param signal - Aborts the request when the load that asked for it is abandoned
 */
export function fetchReviewBacklogs(accountIds?: string[], signal?: AbortSignal) {
  return authenticatedFetch<BankReviewBacklog[]>(
    '/bank-review/backlogs' + buildQueryString({ account_id: accountIds }),
    { signal },
  )
}

/**
 * Adds a new item to the ledger with the values the user chose, answering with the transaction made
 */
export function addReviewItem({ itemId, payload }: { itemId: string; payload: AddReviewItemPayload }) {
  return post<Transaction>(`/bank-review/items/${itemId}/add`, payload)
}

/**
 * How a review item is settled without being added: dismissing a new item, or deciding a correction
 * or removal
 */
export type ReviewResolution = 'dismiss' | 'accept-change' | 'keep-current' | 'remove-from-ledger' | 'keep-transaction'

/**
 * Settles a review item without adding it
 *
 * Accepting a change and both ways of keeping answer with the ledger transaction as it now stands, so
 * its bank source can be patched in place. Dismissing and removing from the ledger answer with nothing
 */
export function resolveReviewItem({ itemId, resolution }: { itemId: string; resolution: ReviewResolution }) {
  return post<Transaction | undefined>(`/bank-review/items/${itemId}/${resolution}`)
}

/**
 * Lists what bulk approval would apply, for some accounts or for all of them
 *
 * @param signal - Aborts the request when the load that asked for it is abandoned
 */
export function fetchBulkApprovalPreview(accountIds?: string[], signal?: AbortSignal) {
  return post<BulkApprovalPreview>('/bank-review/bulk-approve/preview', { account_ids: accountIds ?? null }, { signal })
}

/**
 * Applies the previewed items, each only if the bank has not changed it since the preview
 */
export function applyBulkApproval(payload: BulkApprovalPayload) {
  return post<BulkApprovalResult>('/bank-review/bulk-approve', payload)
}

/**
 * Lists the transactions the bank hasn't posted yet, newest first, for some accounts or for all of them
 *
 * @param signal - Aborts the request when the load that asked for it is abandoned
 */
export function fetchPendingBankTransactions(accountIds?: string[], signal?: AbortSignal) {
  return authenticatedFetch<PendingBankTransaction[]>(
    '/bank-sync/pending' + buildQueryString({ account_id: accountIds }),
    { signal },
  )
}

/**
 * Lists the bank records of no amount that haven't been dismissed, newest first, for some accounts or for all of them
 *
 * @param signal - Aborts the request when the load that asked for it is abandoned
 */
export function fetchBankHolds(accountIds?: string[], signal?: AbortSignal) {
  return authenticatedFetch<BankHold[]>('/bank-sync/holds' + buildQueryString({ account_id: accountIds }), { signal })
}

/**
 * Dismisses a hold, so the same bank record doesn't come back
 */
export function dismissBankHold(holdId: string) {
  return post<undefined>(`/bank-sync/holds/${holdId}/dismiss`)
}

/**
 * Puts the bank's date or amount back on a bank-imported transaction, answering with the transaction
 */
export function restoreBankValue({ transactionId, field }: { transactionId: string; field: EditableBankField }) {
  return post<Transaction>(`/bank-sync/transaction-sources/${transactionId}/restore`, { field })
}
