import { useEffect, useMemo, useRef } from 'react';
import {
  mutationOptions,
  queryOptions,
  skipToken,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from '@tanstack/react-query';
import { BANK_DISCOVERY_POLL_MS } from '@/api/bank-sync/constants';
import {
  getBankLinksPollInterval,
  getBankLinksRefetchOnReturn,
  getBankLinksStaleTime,
  isRefusedRead,
} from '@/api/bank-sync/polling';
import {
  addReviewItem,
  applyBulkApproval,
  claimSetupToken,
  createBankLink,
  deleteBankConnection,
  deleteBankLink,
  dismissCutOffDay,
  dismissHistoryReminder,
  fetchAccountBankStatus,
  fetchBankConnections,
  fetchBankLinks,
  fetchBankProviders,
  fetchBulkApprovalPreview,
  fetchDiscoveredBankAccounts,
  fetchImportRange,
  fetchPendingBankTransactions,
  fetchReviewBacklogs,
  fetchReviewPage,
  fetchReviewPreferences,
  reconnectBankConnection,
  recordOpeningAdjustment,
  resolveReviewItem,
  restoreBankValue,
  skipOpeningAdjustment,
  syncBankLink,
  updateBankConnection,
  updateReviewPreferences,
  type ReviewResolution,
} from '@/api/bank-sync/requests';
import type { AccountBankStatus, BankLink, BankProviderId, BankReviewItem } from '@/api/bank-sync/types';
import {
  invalidateAccountBankLink,
  invalidateBankLinks,
  invalidateBankSyncStatus,
} from '@/api/cache/invalidation';
import { bankSyncKeys } from '@/api/cache/queryKeys';
import {
  applyAccountBankStatus,
  applyBankLinkChanges,
  applyBulkApprovalOutcome,
  applyLedgerReviewOutcome,
  applyOpeningAdjustmentAnswer,
  applyRefusedReviewDecision,
  applyRestoredBankValue,
  applyReviewDecision,
  putCachedBankLink,
  putCachedReviewPreferences,
  refreshBankLinkState,
  replaceCachedBankConnection,
} from '@/api/cache/updates/bankSync';
import { runWithMinimumPendingTime } from '@/api/utils/mutationFeedback';
import { useAuth } from '@/hooks/useAuth';
import { ACTION_LOADING_MIN_MS } from '@/utils/timing';

// The resolutions that change a ledger transaction, while the rest only settle the review item
const LEDGER_WRITING_RESOLUTIONS: ReadonlySet<ReviewResolution> = new Set(['accept-change', 'remove-from-ledger']);

// Bank data changes outside any request this window makes, so a screen that opens reads it again
// rather than trusting a copy the worker may have moved on from
const BANK_DATA_STALE_TIME_MS = 0;

// The app's own default, kept for a link read that failed on the way rather than being refused
const LINKS_READ_RETRIES = 1;

export function useBankProviders() {
  const { accessToken } = useAuth();
  return useQuery({
    queryKey: bankSyncKeys.providers(),
    queryFn: fetchBankProviders,
    enabled: !!accessToken,
    staleTime: BANK_DATA_STALE_TIME_MS,
  });
}

/**
 * Reads the user's connections, checking back while one is waiting on a listing of its bank accounts
 *
 * @param enabled - Whether to read them, for a caller that needs them only some of the time. A read
 * already cached still answers while it's off
 */
export function useBankConnections(enabled = true) {
  const { accessToken } = useAuth();
  return useQuery({
    queryKey: bankSyncKeys.connections(),
    queryFn: fetchBankConnections,
    enabled: !!accessToken && enabled,
    staleTime: BANK_DATA_STALE_TIME_MS,
    refetchInterval: (query) =>
      query.state.data?.some((connection) => connection.discovery_pending) ? BANK_DISCOVERY_POLL_MS : false,
  });
}

/**
 * Reads the bank accounts a connection returns for the account being linked, checking back while a
 * fresh listing runs so a bank just added at the provider appears without reopening the flow
 */
export function useDiscoveredBankAccounts(connectionId: string | null, accountId: string) {
  const { accessToken } = useAuth();
  return useQuery({
    queryKey: bankSyncKeys.discoveredAccounts(connectionId, accountId),
    queryFn: () => fetchDiscoveredBankAccounts(connectionId ?? '', accountId),
    enabled: !!accessToken && connectionId !== null,
    staleTime: BANK_DATA_STALE_TIME_MS,
    refetchInterval: (query) => (query.state.data?.discovery_pending ? BANK_DISCOVERY_POLL_MS : false),
  });
}

/**
 * How every reader reads the link list
 *
 * The list stays fresh until the next poll would read it, so a screen opening between polls takes
 * the polled copy. A read the server refuses is not asked again, neither straight away nor by the
 * next screen to open, so a server without the route answers one request rather than one for every
 * screen
 */
export const bankLinksQueryOptions = queryOptions({
  queryKey: bankSyncKeys.links(),
  queryFn: fetchBankLinks,
  staleTime: (query) => getBankLinksStaleTime(query.state.data),
  retry: (failureCount, error) => !isRefusedRead(error) && failureCount < LINKS_READ_RETRIES,
  retryOnMount: false,
});

/**
 * How the heartbeat reads the link list: on the poll's timer while the tab is in view, and not while
 * it is in the background, where nothing the user sees needs it. Coming back to the tab reads the
 * list at once, so a sync or import that moved on meanwhile shows without waiting for the next tick
 */
export const bankLinksHeartbeatQueryOptions = queryOptions({
  ...bankLinksQueryOptions,
  refetchInterval: (query) => getBankLinksPollInterval(query.state.data, query.state.error),
  refetchOnWindowFocus: (query) => getBankLinksRefetchOnReturn(query.state.data, query.state.error),
});

/**
 * Reads every link with its status
 *
 * Only the heartbeat in the signed-in shell polls, so the list is read on one timer however many
 * screens show it. Every other reader takes what that timer keeps current
 */
export function useBankLinks({ poll = false, enabled = true }: { poll?: boolean; enabled?: boolean } = {}) {
  const { accessToken } = useAuth();
  return useQuery({
    ...(poll ? bankLinksHeartbeatQueryOptions : bankLinksQueryOptions),
    enabled: enabled && !!accessToken,
  });
}

/**
 * Returns the link for each account, keyed by account id
 */
export function useBankLinksByAccount(): Map<string, BankLink> {
  const { data } = useBankLinks();
  return useMemo(() => new Map((data ?? []).map((link) => [link.account_id, link])), [data]);
}

/**
 * Keeps bank sync status current for the signed-in user, from the app shell
 *
 * The one reader that polls the link list while the tab is in view: quickly while one of the user's
 * syncs or imports runs, slowly while any link exists, and not at all without links. A tab in the
 * background stops polling, and coming back to it reads the list at once, so a finished sync never
 * sticks on Syncing. Each change it reads refreshes whatever the worker made stale, and a link that
 * brought in data refreshes the review inbox, the pending strip and the transaction lists
 */
export function useBankSyncHeartbeat(enabled: boolean) {
  const queryClient = useQueryClient();
  const { data: links } = useBankLinks({ poll: true, enabled });
  const previous = useRef(links);

  useEffect(() => {
    const before = previous.current;
    previous.current = links;
    applyBankLinkChanges(queryClient, before, links);
  }, [links, queryClient]);
}

/**
 * Reads one of the user's own personal accounts' link. It needs no poll of its own: the app shell's
 * poll of the link list reads the same link at the same pace, and again on coming back to the tab,
 * and refreshes this read whenever the link changes. Pass `enabled` false for any other account,
 * which the server refuses
 */
export function useAccountBankStatus(accountId: string, enabled: boolean) {
  const { accessToken } = useAuth();
  return useQuery({
    queryKey: bankSyncKeys.accountStatus(accountId),
    queryFn: () => fetchAccountBankStatus(accountId),
    enabled: enabled && !!accessToken,
    staleTime: BANK_DATA_STALE_TIME_MS,
  });
}

/**
 * The days an account can import from through a provider, read once the provider is known
 */
export function useImportRange(accountId: string, provider: BankProviderId | null, enabled: boolean) {
  const { accessToken } = useAuth();
  return useQuery({
    queryKey: bankSyncKeys.importRange(accountId, provider),
    queryFn: provider ? () => fetchImportRange(accountId, provider) : skipToken,
    enabled: !!accessToken && enabled,
    staleTime: BANK_DATA_STALE_TIME_MS,
  });
}

/**
 * Reads whether each kind of bank data arriving for one of the user's own personal accounts waits for
 * review. Pass `enabled` false while nothing shows the choices, and for any other account, which the
 * server refuses
 */
export function useReviewPreferences(accountId: string, enabled: boolean) {
  const { accessToken } = useAuth();
  return useQuery({
    queryKey: bankSyncKeys.reviewPreferences(accountId),
    queryFn: () => fetchReviewPreferences(accountId),
    enabled: enabled && !!accessToken,
  });
}

/**
 * Reads the review inbox a page at a time, newest first, for some accounts or for all of them
 */
export function useReviewItems(accountIds: string[] | undefined, enabled = true) {
  const { accessToken } = useAuth();
  return useInfiniteQuery({
    queryKey: bankSyncKeys.reviewItems(accountIds),
    queryFn: ({ pageParam }) => fetchReviewPage({ accountIds, cursor: pageParam }),
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage.next_cursor,
    enabled: !!accessToken && enabled,
    staleTime: BANK_DATA_STALE_TIME_MS,
  });
}

/**
 * Reads how many new items wait on each account, and whether its sync is paused or warned for
 * them, for some accounts or for all of them
 */
export function useReviewBacklogs(accountIds: string[] | undefined, enabled = true) {
  const { accessToken } = useAuth();
  return useQuery({
    queryKey: bankSyncKeys.reviewBacklogs(accountIds),
    queryFn: () => fetchReviewBacklogs(accountIds),
    enabled: !!accessToken && enabled,
    staleTime: BANK_DATA_STALE_TIME_MS,
  });
}

/**
 * Reads the transactions the bank hasn't posted yet, for some accounts or for all of them
 */
export function usePendingBankTransactions(accountIds: string[] | undefined, enabled = true) {
  const { accessToken } = useAuth();
  return useQuery({
    queryKey: bankSyncKeys.pending(accountIds),
    queryFn: () => fetchPendingBankTransactions(accountIds),
    enabled: !!accessToken && enabled,
    staleTime: BANK_DATA_STALE_TIME_MS,
  });
}

/**
 * Reads what bulk approval would apply anew each time a view showing it mounts, so it never starts
 * from a preview listing items decided since
 */
export function useBulkApprovalPreview(accountIds: string[] | undefined, enabled: boolean) {
  const { accessToken } = useAuth();
  return useQuery({
    queryKey: bankSyncKeys.bulkPreview(accountIds),
    queryFn: () => fetchBulkApprovalPreview(accountIds),
    enabled: !!accessToken && enabled,
    staleTime: BANK_DATA_STALE_TIME_MS,
    refetchOnMount: 'always',
  });
}

/**
 * Sends a setup token even while the browser reports being offline, so a request that cannot go
 * fails at once with a message rather than waiting, with its Cancel held, for a connection
 */
export function claimSetupTokenMutationOptions(queryClient: QueryClient) {
  return mutationOptions({
    mutationFn: (payload: Parameters<typeof claimSetupToken>[0]) =>
      runWithMinimumPendingTime(ACTION_LOADING_MIN_MS, () => claimSetupToken(payload)),
    networkMode: 'always',
    onSuccess: () => invalidateBankSyncStatus(queryClient),
  });
}

export function useClaimSetupToken() {
  const queryClient = useQueryClient();
  return useMutation(claimSetupTokenMutationOptions(queryClient));
}

/**
 * Sends a new setup token the way a claim does, failing at once while offline
 */
export function reconnectBankConnectionMutationOptions(queryClient: QueryClient) {
  return mutationOptions({
    mutationFn: (payload: Parameters<typeof reconnectBankConnection>[0]) =>
      runWithMinimumPendingTime(ACTION_LOADING_MIN_MS, () => reconnectBankConnection(payload)),
    networkMode: 'always',
    onSuccess: () => refreshBankLinkState(queryClient),
  });
}

export function useReconnectBankConnection() {
  const queryClient = useQueryClient();
  return useMutation(reconnectBankConnectionMutationOptions(queryClient));
}

/**
 * Puts the renamed connection in the list at once, so the old name never shows while the list is
 * read again
 */
export function renameBankConnectionMutationOptions(queryClient: QueryClient) {
  return mutationOptions({
    mutationFn: (payload: Parameters<typeof updateBankConnection>[0]) =>
      runWithMinimumPendingTime(ACTION_LOADING_MIN_MS, () => updateBankConnection(payload)),
    onSuccess: (connection) => {
      replaceCachedBankConnection(queryClient, connection);
      invalidateBankSyncStatus(queryClient);
    },
  });
}

export function useRenameBankConnection() {
  const queryClient = useQueryClient();
  return useMutation(renameBankConnectionMutationOptions(queryClient));
}

export function useDisconnectBankConnection() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (connectionId: string) =>
      runWithMinimumPendingTime(ACTION_LOADING_MIN_MS, () => deleteBankConnection(connectionId)),
    onSuccess: () => refreshBankLinkState(queryClient),
  });
}

export function useLinkBankAccount() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: Parameters<typeof createBankLink>[0]) =>
      runWithMinimumPendingTime(ACTION_LOADING_MIN_MS, () => createBankLink(payload)),
    onSuccess: () => refreshBankLinkState(queryClient),
  });
}

export function useUnlinkBankAccount() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (accountId: string) => runWithMinimumPendingTime(ACTION_LOADING_MIN_MS, () => deleteBankLink(accountId)),
    onSuccess: () => refreshBankLinkState(queryClient),
  });
}

/**
 * Settles once the cached link list, as the heartbeat keeps it, shows that a worker has started the
 * account's requested sync, or that the account is no longer linked. In a tab in the background that
 * is the read made on coming back to it
 */
function waitForSyncStart(queryClient: QueryClient, accountId: string): Promise<void> {
  const started = () => !queryClient
    .getQueryData<BankLink[]>(bankSyncKeys.links())
    ?.find((link) => link.account_id === accountId)
    ?.sync.sync_requested;
  if (started()) return Promise.resolve();

  return new Promise((resolve) => {
    const unsubscribe = queryClient.getQueryCache().subscribe(() => {
      if (!started()) return;
      unsubscribe();
      resolve();
    });
  });
}

/**
 * How Sync now runs. The server queues the sync and answers with the link marked as requested, in the
 * state it had, since the link reads as Syncing only once a worker runs the sync. The answer goes
 * straight into the cached list, even one read before the link was made, which takes the poll to its
 * fast pace without waiting to read the list again, and the request settles once a read of the list
 * shows a worker started the sync: the poll's, or in a tab in the background the read made on coming
 * back to it, so a button pending on it says the sync is starting until then. A refusal means the
 * status shown is out of date, so the list is read again instead
 */
export function syncBankAccountMutationOptions(queryClient: QueryClient) {
  return mutationOptions({
    mutationFn: async (accountId: string) => {
      const link = await runWithMinimumPendingTime(ACTION_LOADING_MIN_MS, () => syncBankLink(accountId));
      putCachedBankLink(queryClient, link);
      await waitForSyncStart(queryClient, accountId);
      return link;
    },
    onError: () => invalidateBankLinks(queryClient),
    onSettled: () => invalidateBankSyncStatus(queryClient),
  });
}

export function useSyncBankAccount() {
  const queryClient = useQueryClient();
  return useMutation(syncBankAccountMutationOptions(queryClient));
}

/**
 * How a reminder's ✕ in the Bank link section runs, sending the request that dismisses that kind of
 * reminder. The account's bank link the server answers with folds the reminder away, or shows a newer
 * one raised meanwhile. A failure reads the account's bank link again, so the reminder shown is the
 * server's
 */
export function dismissBankReminderMutationOptions<Payload extends { accountId: string }>(
  queryClient: QueryClient,
  dismiss: (payload: Payload) => Promise<AccountBankStatus>,
) {
  return mutationOptions({
    mutationFn: (payload: Payload) => runWithMinimumPendingTime(ACTION_LOADING_MIN_MS, () => dismiss(payload)),
    onSuccess: (status) => applyAccountBankStatus(queryClient, status),
    onError: (_error, { accountId }) => invalidateAccountBankLink(queryClient, accountId),
  });
}

export function useDismissHistoryReminder() {
  const queryClient = useQueryClient();
  return useMutation(dismissBankReminderMutationOptions(queryClient, dismissHistoryReminder));
}

export function useDismissCutOffDay() {
  const queryClient = useQueryClient();
  return useMutation(dismissBankReminderMutationOptions(queryClient, dismissCutOffDay));
}

/**
 * How Record adjustment runs. The account's bank link the server answers with folds the offer away.
 * A refusal means the offer shown is out of date, answered elsewhere or no longer offered, so the
 * account's bank link and the link list are read again
 */
export function recordOpeningAdjustmentMutationOptions(queryClient: QueryClient) {
  return mutationOptions({
    mutationFn: (payload: Parameters<typeof recordOpeningAdjustment>[0]) =>
      runWithMinimumPendingTime(ACTION_LOADING_MIN_MS, () => recordOpeningAdjustment(payload)),
    onSuccess: (status) => applyOpeningAdjustmentAnswer(queryClient, status, true),
    onError: (_error, { accountId }) => invalidateAccountBankLink(queryClient, accountId),
  });
}

export function useRecordOpeningAdjustment() {
  const queryClient = useQueryClient();
  return useMutation(recordOpeningAdjustmentMutationOptions(queryClient));
}

/**
 * How Skip runs, as Record adjustment does without recording anything
 */
export function skipOpeningAdjustmentMutationOptions(queryClient: QueryClient) {
  return mutationOptions({
    mutationFn: (accountId: string) =>
      runWithMinimumPendingTime(ACTION_LOADING_MIN_MS, () => skipOpeningAdjustment(accountId)),
    onSuccess: (status) => applyOpeningAdjustmentAnswer(queryClient, status, false),
    onError: (_error, accountId) => invalidateAccountBankLink(queryClient, accountId),
  });
}

export function useSkipOpeningAdjustment() {
  const queryClient = useQueryClient();
  return useMutation(skipOpeningAdjustmentMutationOptions(queryClient));
}

export function useUpdateReviewPreferences() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: Parameters<typeof updateReviewPreferences>[0]) =>
      runWithMinimumPendingTime(ACTION_LOADING_MIN_MS, () => updateReviewPreferences(payload)),
    onSuccess: (preferences, { accountId }) => {
      putCachedReviewPreferences(queryClient, accountId, preferences);
    },
  });
}

/**
 * How Add to ledger runs. A refusal reads the inbox again, since the item may have been decided
 * elsewhere or withdrawn by the bank since it was read
 */
export function addReviewItemMutationOptions(queryClient: QueryClient) {
  return mutationOptions({
    mutationFn: (payload: Parameters<typeof addReviewItem>[0]) =>
      runWithMinimumPendingTime(ACTION_LOADING_MIN_MS, () => addReviewItem(payload)),
    onSuccess: (transaction, { itemId }) =>
      applyLedgerReviewOutcome(queryClient, [transaction.account_id], (item) => item.id === itemId),
    onError: () => applyRefusedReviewDecision(queryClient),
  });
}

export function useAddReviewItem() {
  const queryClient = useQueryClient();
  return useMutation(addReviewItemMutationOptions(queryClient));
}

/**
 * How a review item is settled without being added: a new item dismissed, or a correction or removal
 * decided. A refusal reads the inbox again, as one of Add to ledger does
 */
export function resolveReviewItemMutationOptions(queryClient: QueryClient) {
  return mutationOptions({
    mutationFn: (payload: Parameters<typeof resolveReviewItem>[0] & { accountId: string }) =>
      runWithMinimumPendingTime(ACTION_LOADING_MIN_MS, () => resolveReviewItem(payload)),
    onSuccess: (transaction, { accountId, itemId, resolution }) => {
      const isDecided = (item: { id: string }) => item.id === itemId;
      if (LEDGER_WRITING_RESOLUTIONS.has(resolution)) {
        return applyLedgerReviewOutcome(queryClient, [accountId], isDecided);
      }

      // Nothing in the ledger changed, so its views keep their data rather than reloading
      return applyReviewDecision(queryClient, isDecided, transaction);
    },
    onError: () => applyRefusedReviewDecision(queryClient),
  });
}

export function useResolveReviewItem() {
  const queryClient = useQueryClient();
  return useMutation(resolveReviewItemMutationOptions(queryClient));
}

/**
 * Applies the items a preview listed, each at the version it showed, leaving waiting any the bank
 * changed since. Settles once the ledger and the review block show the outcome
 */
export function useApplyBulkApproval() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ items }: { scope: string[] | undefined; items: BankReviewItem[] }) =>
      runWithMinimumPendingTime(ACTION_LOADING_MIN_MS, () =>
        applyBulkApproval({ items: items.map(({ id, version }) => ({ id, version })) })),
    onSuccess: (result, { scope, items }) => {
      const appliedIds = new Set(result.applied_ids);
      return applyBulkApprovalOutcome(queryClient, scope, items.filter((item) => appliedIds.has(item.id)));
    },
  });
}

export function useRestoreBankValue() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: Parameters<typeof restoreBankValue>[0]) =>
      runWithMinimumPendingTime(ACTION_LOADING_MIN_MS, () => restoreBankValue(payload)),
    onSuccess: (transaction, { field }) => applyRestoredBankValue(queryClient, transaction, field),
  });
}
