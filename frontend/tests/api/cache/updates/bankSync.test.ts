/**
 * Covers the cache writes behind bank sync: the polled link list, review decisions and account deletion
 *
 * These tests catch a polled link list that changed nothing refetching every bank view, a sync that
 * brought in data leaving the review inbox, pending rows, transaction lists or the account's balance
 * stale, a decided item staying in a later page or its count, and a deleted account's items lingering
 * in a cached bulk approval preview
 */
import { QueryClient, type InfiniteData, type QueryKey } from '@tanstack/react-query';
import { beforeEach, describe, expect, it } from 'vitest';
import { accountKeys, bankSyncKeys, transactionKeys } from '@/api/cache/queryKeys';
import {
  applyBankLinkChanges,
  clearDeletedAccountBankData,
  removeReviewItemsFromPages,
} from '@/api/cache/updates/bankSync';
import type { BankLink, BankReviewItem, BankReviewItemKind, BankReviewPage } from '@/api/bank-sync/types';

let queryClient: QueryClient;

beforeEach(() => {
  queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false } } });
});

function createBankLink(overrides: Partial<BankLink> = {}): BankLink {
  return {
    account_id: 'account-1',
    connection_id: 'connection-1',
    provider: 'simplefin',
    provider_name: 'SimpleFIN',
    external_account_id: 'bank-account-1',
    external_account_name: 'Chequing',
    institution_name: 'Example Bank',
    import_start: '2026-01-01',
    linked_at: '2026-09-01T12:00:00Z',
    import: null,
    history_reminder: null,
    last_success_at: '2026-09-30T12:00:00Z',
    last_attempt: null,
    next_attempt_at: '2026-10-01T00:00:00Z',
    waiting_on_budget: false,
    sync_in_progress: false,
    action_needed: null,
    waiting_new_count: 0,
    review_warning: false,
    paused: false,
    balance: null,
    ...overrides,
  };
}

function createReviewItem(id: string, kind: BankReviewItemKind): BankReviewItem {
  return {
    id,
    kind,
    account_id: 'account-1',
    provider: 'simplefin',
    provider_name: 'SimpleFIN',
    external_transaction_id: `bank-${id}`,
    received_at: '2026-09-30T12:00:00Z',
    version: 1,
    bank: {
      date: '2026-09-29',
      amount: -1250,
      raw_amount: null,
      description: 'Coffee',
      merchant_name: null,
      category_hint: null,
    },
    transaction_id: kind === 'new' ? null : `transaction-${id}`,
    current: null,
    changed_fields: kind === 'correction' ? ['amount'] : [],
    protected_fields: [],
  };
}

const statusKeys: QueryKey[] = [
  bankSyncKeys.accountStatus('account-1'),
  bankSyncKeys.connections(),
  bankSyncKeys.providers(),
];
const reviewKeys: QueryKey[] = [
  bankSyncKeys.reviewItems(undefined),
  bankSyncKeys.pending('account-1'),
  bankSyncKeys.bulkPreview(undefined),
];
const ledgerKeys: QueryKey[] = [transactionKeys.list({}), accountKeys.detail('account-1')];
const otherAccountKey = accountKeys.detail('account-2');

/** Seeds one cached query under every key the polled link list can make stale */
function seedBankViews(): void {
  for (const key of [...statusKeys, ...reviewKeys, ...ledgerKeys, otherAccountKey]) {
    queryClient.setQueryData(key, {});
  }
}

function expectInvalidated(keys: QueryKey[], invalidated: boolean): void {
  for (const key of keys) {
    expect(queryClient.getQueryState(key)?.isInvalidated, JSON.stringify(key)).toBe(invalidated);
  }
}

describe('a polled change in the link list', () => {
  const before = [createBankLink(), createBankLink({ account_id: 'account-2' })];

  beforeEach(seedBankViews);

  it('refreshes nothing when the links read the same as before', () => {
    applyBankLinkChanges(queryClient, before, before.map((link) => ({ ...link })));

    expectInvalidated([...statusKeys, ...reviewKeys, ...ledgerKeys], false);
  });

  it('refreshes only the status when a sync fails', () => {
    const after = [
      createBankLink({ last_attempt: { at: '2026-10-01T00:00:00Z', outcome: 'failure', reason: 'Bank unavailable' } }),
      before[1],
    ];

    applyBankLinkChanges(queryClient, before, after);

    expectInvalidated(statusKeys, true);
    expectInvalidated([...reviewKeys, ...ledgerKeys], false);
  });

  it('refreshes the inbox, the ledger and the synced account when a sync brings in data', () => {
    const after = [createBankLink({ last_success_at: '2026-10-01T00:00:00Z' }), before[1]];

    applyBankLinkChanges(queryClient, before, after);

    expectInvalidated([...statusKeys, ...reviewKeys, ...ledgerKeys], true);
    expectInvalidated([otherAccountKey], false);
  });

  it('refreshes the inbox when an import finishes another part', () => {
    const progress = {
      kind: 'initial',
      state: 'running',
      requested_start: '2025-01-01',
      windows_total: 6,
      windows_done: 2,
      items_found: 40,
      earliest_returned_date: null,
    } as const;
    const importing = [createBankLink({ import: progress }), before[1]];
    const advanced = [createBankLink({ import: { ...progress, windows_done: 3, items_found: 55 } }), before[1]];

    applyBankLinkChanges(queryClient, importing, advanced);

    expectInvalidated(reviewKeys, true);
  });

  it('refreshes only the status when a link is removed elsewhere', () => {
    applyBankLinkChanges(queryClient, before, [before[0]]);

    expectInvalidated(statusKeys, true);
    expectInvalidated([...reviewKeys, ...ledgerKeys], false);
  });
});

describe('decided review items', () => {
  const firstPage: BankReviewPage = {
    items: [createReviewItem('item-1', 'new'), createReviewItem('item-2', 'new')],
    counts: { new: 3, correction: 1, removal: 0 },
    next_cursor: 'cursor-2',
  };
  const secondPage: BankReviewPage = {
    items: [createReviewItem('item-3', 'new'), createReviewItem('item-4', 'correction')],
    counts: { new: 3, correction: 1, removal: 0 },
    next_cursor: null,
  };
  const key = bankSyncKeys.reviewItems(undefined);

  beforeEach(() => {
    queryClient.setQueryData<InfiniteData<BankReviewPage, string | null>>(key, {
      pages: [firstPage, secondPage],
      pageParams: [null, 'cursor-2'],
    });
  });

  it('leave every cached page, and every page count, while the cursors stay', () => {
    removeReviewItemsFromPages(queryClient, (item) => item.id === 'item-1' || item.id === 'item-4');

    const data = queryClient.getQueryData<InfiniteData<BankReviewPage, string | null>>(key);
    expect(data?.pages.map((page) => page.items.map((item) => item.id))).toEqual([['item-2'], ['item-3']]);
    expect(data?.pages.map((page) => page.counts)).toEqual([
      { new: 2, correction: 0, removal: 0 },
      { new: 2, correction: 0, removal: 0 },
    ]);
    expect(data?.pages.map((page) => page.next_cursor)).toEqual(['cursor-2', null]);
    expect(data?.pageParams).toEqual([null, 'cursor-2']);
  });

  it('leave the cached list untouched when none of them is cached', () => {
    const cached = queryClient.getQueryData(key);

    removeReviewItemsFromPages(queryClient, (item) => item.id === 'item-9');

    expect(queryClient.getQueryData(key)).toBe(cached);
  });
});

describe('a deleted account', () => {
  it('drops any cached bulk approval preview and refreshes the rest of bank sync', () => {
    queryClient.setQueryData(bankSyncKeys.bulkPreview(undefined), {});
    queryClient.setQueryData(bankSyncKeys.links(), [createBankLink()]);

    clearDeletedAccountBankData(queryClient);

    expect(queryClient.getQueryState(bankSyncKeys.bulkPreview(undefined))).toBeUndefined();
    expectInvalidated([bankSyncKeys.links()], true);
  });
});
