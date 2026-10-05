import { useEffect, useMemo, useRef } from 'react';
import {
  mutationOptions,
  queryOptions,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from '@tanstack/react-query';
import { BANK_DISCOVERY_POLL_MS } from '@/api/bank-sync/constants';
import { getBankLinksPollInterval, getBankLinksStaleTime, isRefusedRead } from '@/api/bank-sync/polling';
import {
  acceptOpeningAdjustment,
  addReviewItem,
  applyBulkApproval,
  claimSetupToken,
  createBankLink,
  deleteBankConnection,
  deleteBankLink,
  dismissHistoryReminder,
  fetchAccountBankStatus,
  fetchBankConnections,
  fetchBankLinks,
  fetchBankProviders,
  fetchBulkApprovalPreview,
  fetchDiscoveredBankAccounts,
  fetchImportRange,
  fetchOpeningAdjustment,
  fetchPendingBankTransactions,
  fetchReviewBacklogs,
  fetchReviewPage,
  fetchReviewPreferences,
  reconnectBankConnection,
  resolveReviewItem,
  restoreBankValue,
  skipOpeningAdjustment,
  syncBankLink,
  updateBankConnection,
  updateReviewPreferences,
  type ReviewResolution,
} from '@/api/bank-sync/requests';
import type { BankLink, BankProviderId, BulkApprovalPayload } from '@/api/bank-sync/types';
import {
  invalidateBankLinks,
  invalidateBankReview,
  invalidateBankSyncStatus,
} from '@/api/cache/invalidation';
import { bankSyncKeys } from '@/api/cache/queryKeys';
import {
  applyBankLinkChanges,
  applyLedgerReviewOutcome,
  applyRestoredBankValue,
  applyReviewDecision,
  refreshBankLinkState,
  replaceCachedBankLink,
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
 */
export function useBankConnections() {
  const { accessToken } = useAuth();
  return useQuery({
    queryKey: bankSyncKeys.connections(),
    queryFn: fetchBankConnections,
    enabled: !!accessToken,
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
 * Reads every link with its status
 *
 * Only the heartbeat in the signed-in shell polls, so the list is read on one timer however many
 * screens show it. Every other reader takes what that timer keeps current
 */
export function useBankLinks({ poll = false, enabled = true }: { poll?: boolean; enabled?: boolean } = {}) {
  const { accessToken } = useAuth();
  return useQuery({
    ...bankLinksQueryOptions,
    enabled: enabled && !!accessToken,
    refetchInterval: poll ? (query) => getBankLinksPollInterval(query.state.data, query.state.error) : false,
    refetchIntervalInBackground: poll,
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
 * The one reader that polls the link list: quickly while one of the user's syncs or imports runs,
 * including while the tab is in the background so a finished sync never sticks on Syncing, slowly
 * while any link exists, and not at all without links. Each change it reads refreshes whatever the
 * worker made stale, and a link that brought in data refreshes the review inbox, the pending strip
 * and the transaction lists
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

export function useAccountBankStatus(accountId: string | undefined) {
  const { accessToken } = useAuth();
  return useQuery({
    queryKey: bankSyncKeys.accountStatus(accountId ?? ''),
    queryFn: () => fetchAccountBankStatus(accountId ?? ''),
    enabled: !!accessToken && !!accountId,
    staleTime: BANK_DATA_STALE_TIME_MS,
  });
}

export function useImportRange(accountId: string, provider: BankProviderId, enabled: boolean) {
  const { accessToken } = useAuth();
  return useQuery({
    queryKey: bankSyncKeys.importRange(accountId, provider),
    queryFn: () => fetchImportRange(accountId, provider),
    enabled: !!accessToken && enabled,
    staleTime: BANK_DATA_STALE_TIME_MS,
  });
}

export function useOpeningAdjustment(accountId: string, enabled: boolean) {
  const { accessToken } = useAuth();
  return useQuery({
    queryKey: bankSyncKeys.openingAdjustment(accountId),
    queryFn: () => fetchOpeningAdjustment(accountId),
    enabled: !!accessToken && enabled,
    staleTime: BANK_DATA_STALE_TIME_MS,
  });
}

export function useReviewPreferences(accountId: string) {
  const { accessToken } = useAuth();
  return useQuery({
    queryKey: bankSyncKeys.reviewPreferences(accountId),
    queryFn: () => fetchReviewPreferences(accountId),
    enabled: !!accessToken,
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

export function usePendingBankTransactions(accountId?: string) {
  const { accessToken } = useAuth();
  return useQuery({
    queryKey: bankSyncKeys.pending(accountId),
    queryFn: () => fetchPendingBankTransactions(accountId),
    enabled: !!accessToken,
    staleTime: BANK_DATA_STALE_TIME_MS,
  });
}

export function useBulkApprovalPreview(accountIds: string[] | undefined, enabled: boolean) {
  const { accessToken } = useAuth();
  return useQuery({
    queryKey: bankSyncKeys.bulkPreview(accountIds),
    queryFn: () => fetchBulkApprovalPreview(accountIds),
    enabled: !!accessToken && enabled,
    staleTime: BANK_DATA_STALE_TIME_MS,
  });
}

export function useClaimSetupToken() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: Parameters<typeof claimSetupToken>[0]) =>
      runWithMinimumPendingTime(ACTION_LOADING_MIN_MS, () => claimSetupToken(payload)),
    onSuccess: () => invalidateBankSyncStatus(queryClient),
  });
}

export function useReconnectBankConnection() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: Parameters<typeof reconnectBankConnection>[0]) =>
      runWithMinimumPendingTime(ACTION_LOADING_MIN_MS, () => reconnectBankConnection(payload)),
    onSuccess: () => refreshBankLinkState(queryClient),
  });
}

export function useRenameBankConnection() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: Parameters<typeof updateBankConnection>[0]) =>
      runWithMinimumPendingTime(ACTION_LOADING_MIN_MS, () => updateBankConnection(payload)),
    onSuccess: () => invalidateBankSyncStatus(queryClient),
  });
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
 * How Sync now runs. The link the server answers with already shows the sync in progress, which goes
 * straight into the cached list, so the status shows Syncing and the poll takes its fast pace without
 * waiting to read the list again. A refusal means the status shown is out of date, so the list is
 * read again instead
 */
export function syncBankAccountMutationOptions(queryClient: QueryClient) {
  return mutationOptions({
    mutationFn: (accountId: string) => runWithMinimumPendingTime(ACTION_LOADING_MIN_MS, () => syncBankLink(accountId)),
    onSuccess: (link) => replaceCachedBankLink(queryClient, link),
    onError: () => invalidateBankLinks(queryClient),
    onSettled: () => invalidateBankSyncStatus(queryClient),
  });
}

export function useSyncBankAccount() {
  const queryClient = useQueryClient();
  return useMutation(syncBankAccountMutationOptions(queryClient));
}

export function useDismissHistoryReminder() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (accountId: string) =>
      runWithMinimumPendingTime(ACTION_LOADING_MIN_MS, () => dismissHistoryReminder(accountId)),
    onSuccess: () => {
      invalidateBankLinks(queryClient);
      invalidateBankSyncStatus(queryClient);
    },
  });
}

export function useAcceptOpeningAdjustment() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: Parameters<typeof acceptOpeningAdjustment>[0]) =>
      runWithMinimumPendingTime(ACTION_LOADING_MIN_MS, () => acceptOpeningAdjustment(payload)),
    onSuccess: (_offer, { accountId }) => applyLedgerReviewOutcome(queryClient, [accountId], () => false),
  });
}

export function useSkipOpeningAdjustment() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (accountId: string) =>
      runWithMinimumPendingTime(ACTION_LOADING_MIN_MS, () => skipOpeningAdjustment(accountId)),
    onSuccess: () => invalidateBankSyncStatus(queryClient),
  });
}

export function useUpdateReviewPreferences() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: Parameters<typeof updateReviewPreferences>[0]) =>
      runWithMinimumPendingTime(ACTION_LOADING_MIN_MS, () => updateReviewPreferences(payload)),
    onSuccess: (preferences, { accountId }) => {
      queryClient.setQueryData(bankSyncKeys.reviewPreferences(accountId), preferences);
    },
  });
}

export function useAddReviewItem() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: Parameters<typeof addReviewItem>[0]) =>
      runWithMinimumPendingTime(ACTION_LOADING_MIN_MS, () => addReviewItem(payload)),
    onSuccess: (transaction, { itemId }) =>
      applyLedgerReviewOutcome(queryClient, [transaction.account_id], (item) => item.id === itemId),
  });
}

export function useResolveReviewItem() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: Parameters<typeof resolveReviewItem>[0] & { accountId: string }) =>
      runWithMinimumPendingTime(ACTION_LOADING_MIN_MS, () => resolveReviewItem(payload)),
    onSuccess: (transaction, { accountId, itemId, resolution }) => {
      const isDecided = (item: { id: string }) => item.id === itemId;
      if (LEDGER_WRITING_RESOLUTIONS.has(resolution)) {
        return applyLedgerReviewOutcome(queryClient, [accountId], isDecided);
      }

      // Nothing in the ledger changed, so its views keep their data rather than reloading
      applyReviewDecision(queryClient, isDecided, transaction);
    },
  });
}

/**
 * Applies the items the preview listed, which the server decides, leaving waiting any the bank
 * changed since the preview
 */
export function useApplyBulkApproval() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: BulkApprovalPayload & { accountIds: string[] }) =>
      runWithMinimumPendingTime(ACTION_LOADING_MIN_MS, () => applyBulkApproval({ items: payload.items })),
    onSuccess: async (_result, { accountIds, items }) => {
      // An item the bank changed since the preview stays waiting, so only the inbox refetch can say
      // which ones went. The previewed ones leave at once, and the refetch brings back any that stayed
      const previewed = new Set(items.map((item) => item.id));
      await applyLedgerReviewOutcome(queryClient, accountIds, (item) => previewed.has(item.id));
      invalidateBankReview(queryClient);
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
