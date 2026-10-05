/**
 * Covers the cache writes behind bank sync: the polled link list, review decisions, a restored bank
 * value, a link made or removed, and account deletion. A Sync now answer is covered with the link
 * list read
 *
 * These tests catch a polled link list that changed nothing refetching every bank view, a first read
 * taken for every link appearing at once, a sync that
 * brought in data leaving the review inbox, pending rows, transaction lists or the account's balance
 * stale, a link moved to Choose bank account or removed leaving its cleared pending rows on screen, a decided item staying in a later page or its count, an item leaving the inbox before its
 * transaction shows in the list or the backlog notice counts it out, a decision that left the ledger
 * alone reloading it or taking its item out before both the links and the backlogs have refetched, a
 * restored bank value leaving the inbox showing the ledger value it replaced, a link change settling
 * before the views that show it have refetched, and a deleted account's items lingering in a cached
 * bulk approval preview
 */
import { QueryClient, QueryObserver, type InfiniteData, type QueryKey } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { BankReviewPage } from '@/api/bank-sync/types';
import { accountKeys, bankSyncKeys, transactionKeys } from '@/api/cache/queryKeys';
import {
  applyBankLinkChanges,
  applyLedgerReviewOutcome,
  applyRestoredBankValue,
  applyReviewDecision,
  clearDeletedAccountBankData,
  refreshBankLinkState,
  removeReviewItemsFromPages,
} from '@/api/cache/updates/bankSync';
import type { Transaction } from '@/api/transactions/types';
import { createBacklog, createBankLink, createBankTransaction, createReviewItem } from './fixtures';

type CachedReviewPages = InfiniteData<BankReviewPage, string | null>;

let queryClient: QueryClient;
let unsubscribes: Array<() => void> = [];

beforeEach(() => {
  queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false } } });
});

afterEach(() => {
  for (const unsubscribe of unsubscribes) unsubscribe();
  unsubscribes = [];
  queryClient.clear();
});

const statusKeys: QueryKey[] = [
  bankSyncKeys.accountStatus('account-1'),
  bankSyncKeys.connections(),
  bankSyncKeys.providers(),
];
const backlogKey = bankSyncKeys.reviewBacklogs(undefined);
const reviewKeys: QueryKey[] = [
  bankSyncKeys.reviewItems(undefined),
  backlogKey,
  bankSyncKeys.bulkPreview(undefined),
];
const pendingKey = bankSyncKeys.pending(['account-1']);
const ledgerKeys: QueryKey[] = [transactionKeys.list({}), accountKeys.detail('account-1')];
const otherAccountKey = accountKeys.detail('account-2');
const reviewKey = bankSyncKeys.reviewItems(undefined);

/** Seeds one cached query under every key the polled link list can make stale */
function seedBankViews(): void {
  for (const key of [...statusKeys, ...reviewKeys, pendingKey, ...ledgerKeys, otherAccountKey]) {
    queryClient.setQueryData(key, {});
  }
}

/** Seeds the review inbox as two pages of two items each */
function seedReviewPages(): void {
  queryClient.setQueryData<CachedReviewPages>(reviewKey, {
    pages: [
      {
        items: [createReviewItem('item-1', 'new'), createReviewItem('item-2', 'new')],
        counts: { new: 3, correction: 1, removal: 0 },
        next_cursor: 'cursor-2',
      },
      {
        items: [createReviewItem('item-3', 'new'), createReviewItem('item-4', 'correction')],
        counts: { new: 3, correction: 1, removal: 0 },
        next_cursor: null,
      },
    ],
    pageParams: [null, 'cursor-2'],
  });
}

function reviewItemIds(): string[] {
  return queryClient.getQueryData<CachedReviewPages>(reviewKey)?.pages.flatMap((page) => page.items.map((item) => item.id)) ?? [];
}

/**
 * Keeps a query on screen, the way a mounted view would, with a read that answers only when the test
 * says, so a caller waiting on the refetch can be caught waiting
 */
function observeWithHeldRead(key: QueryKey, data: unknown): () => void {
  let answer: () => void = () => {};
  const read = new Promise<unknown>((resolve) => {
    answer = () => resolve(data);
  });
  queryClient.setQueryData(key, data);
  const observer = new QueryObserver(queryClient, { queryKey: key, queryFn: () => read, staleTime: Infinity });
  unsubscribes.push(observer.subscribe(() => {}));
  return answer;
}

/** Lets pending promise callbacks run */
function settle(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
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

    expectInvalidated([...statusKeys, ...reviewKeys, pendingKey, ...ledgerKeys], false);
  });

  it.each([
    ['the first read, with no list before it', undefined, before],
    ['a list that has gone from the cache', before, undefined],
  ])('refreshes nothing for %s', (_, previous, next) => {
    applyBankLinkChanges(queryClient, previous, next);

    expectInvalidated([...statusKeys, ...reviewKeys, pendingKey, ...ledgerKeys], false);
  });

  // A move to Choose bank account and a removal each clear the link's pending rows without bringing
  // in data
  it.each([
    [
      'a sync fails',
      [createBankLink({ last_attempt: { at: '2026-10-01T00:00:00Z', outcome: 'failure', reason: 'Bank unavailable' } }), before[1]],
    ],
    [
      'a link moves to Choose bank account',
      [
        createBankLink({ action_needed: { kind: 'choose_account', since: '2026-10-01T00:00:00Z', message: 'Choose the bank account again' } }),
        before[1],
      ],
    ],
    ['a link is removed elsewhere', [before[0]]],
  ])('refreshes the status and the pending strip, leaving the inbox and the ledger, when %s', (_, after) => {
    applyBankLinkChanges(queryClient, before, after);

    expectInvalidated([...statusKeys, pendingKey], true);
    expectInvalidated([...reviewKeys, ...ledgerKeys], false);
  });

  it('refreshes the inbox, the pending strip, the ledger and the synced account when a sync brings in data', () => {
    const after = [createBankLink({ last_success_at: '2026-10-01T00:00:00Z' }), before[1]];

    applyBankLinkChanges(queryClient, before, after);

    expectInvalidated([...statusKeys, ...reviewKeys, pendingKey, ...ledgerKeys], true);
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

    expectInvalidated([...reviewKeys, pendingKey], true);
  });
});

describe('decided review items', () => {
  beforeEach(seedReviewPages);

  it('leave every cached page, and every page count, while the cursors stay', () => {
    removeReviewItemsFromPages(queryClient, (item) => item.id === 'item-1' || item.id === 'item-4');

    const data = queryClient.getQueryData<CachedReviewPages>(reviewKey);
    expect(data?.pages.map((page) => page.items.map((item) => item.id))).toEqual([['item-2'], ['item-3']]);
    expect(data?.pages.map((page) => page.counts)).toEqual([
      { new: 2, correction: 0, removal: 0 },
      { new: 2, correction: 0, removal: 0 },
    ]);
    expect(data?.pages.map((page) => page.next_cursor)).toEqual(['cursor-2', null]);
    expect(data?.pageParams).toEqual([null, 'cursor-2']);
  });

  it('leave the cached list untouched when none of them is cached', () => {
    const cached = queryClient.getQueryData(reviewKey);

    removeReviewItemsFromPages(queryClient, (item) => item.id === 'item-9');

    expect(queryClient.getQueryData(reviewKey)).toBe(cached);
  });

  it('leave the cached backlogs, which hold no pages, as they were', () => {
    const backlogs = [createBacklog()];
    queryClient.setQueryData(backlogKey, backlogs);

    removeReviewItemsFromPages(queryClient, (item) => item.id === 'item-1');

    expect(queryClient.getQueryData(backlogKey)).toBe(backlogs);
  });
});

describe('a review decision that wrote to the ledger', () => {
  beforeEach(() => {
    seedBankViews();
    seedReviewPages();
  });

  it('takes the item out of the inbox only once the transaction list and the backlogs have refetched', async () => {
    const answerTransactions = observeWithHeldRead(transactionKeys.list({ account_id: 'account-1' }), []);
    const answerLinks = observeWithHeldRead(bankSyncKeys.links(), [createBankLink()]);
    const answerBacklogs = observeWithHeldRead(backlogKey, [createBacklog()]);

    const done = applyLedgerReviewOutcome(queryClient, ['account-1'], (item) => item.id === 'item-1');
    await settle();

    expect(reviewItemIds()).toContain('item-1');

    answerTransactions();
    answerLinks();
    await settle();

    // The backlog notice would otherwise count an item the block no longer shows
    expect(reviewItemIds()).toContain('item-1');

    answerBacklogs();
    await done;

    expect(reviewItemIds()).toEqual(['item-2', 'item-3', 'item-4']);
    expectInvalidated([...statusKeys, bankSyncKeys.bulkPreview(undefined), accountKeys.detail('account-1')], true);
    expectInvalidated([otherAccountKey], false);
  });
});

describe('a review decision that left the ledger alone', () => {
  const waiting = createBankTransaction('transaction-item-4', 'item-4');
  const kept = createBankTransaction('transaction-item-4');

  let answerLinks: () => void;
  let answerBacklogs: () => void;

  beforeEach(() => {
    seedReviewPages();
    answerLinks = observeWithHeldRead(bankSyncKeys.links(), [createBankLink()]);
    answerBacklogs = observeWithHeldRead(backlogKey, [createBacklog()]);
    queryClient.setQueryData(bankSyncKeys.bulkPreview(undefined), {});
    for (const key of statusKeys) queryClient.setQueryData(key, {});
    queryClient.setQueryData(transactionKeys.list({}), [waiting]);
  });

  it.each(['links', 'backlogs'] as const)(
    'puts the kept transaction in place once the links and the backlogs have both refetched, the %s answering first, without reloading the ledger',
    async (first) => {
      const done = applyReviewDecision(queryClient, (item) => item.id === 'item-4', kept);
      const [answerFirst, answerSecond] = first === 'links' ? [answerLinks, answerBacklogs] : [answerBacklogs, answerLinks];
      answerFirst();
      await settle();

      // The waiting count the other read carries would otherwise still include an item the block no
      // longer shows, in the sync status for the links and in the backlog notice for the backlogs,
      // beside a marker that has already cleared
      expect(reviewItemIds()).toContain('item-4');
      expect(queryClient.getQueryData<Transaction[]>(transactionKeys.list({}))).toEqual([waiting]);

      answerSecond();
      await done;

      expect(queryClient.getQueryData<Transaction[]>(transactionKeys.list({}))).toEqual([kept]);
      expect(reviewItemIds()).toEqual(['item-1', 'item-2', 'item-3']);
      expectInvalidated([...statusKeys, bankSyncKeys.bulkPreview(undefined)], true);
      expectInvalidated([transactionKeys.list({})], false);
    },
  );

  it('settles a dismissed item, which answers with no transaction, leaving the ledger as it was', async () => {
    const done = applyReviewDecision(queryClient, (item) => item.id === 'item-1', undefined);
    answerLinks();
    answerBacklogs();
    await done;

    expect(queryClient.getQueryData<Transaction[]>(transactionKeys.list({}))).toEqual([waiting]);
    expect(reviewItemIds()).toEqual(['item-2', 'item-3', 'item-4']);
  });
});

describe('a restored bank value', () => {
  const edited = { ...createBankTransaction('transaction-1'), amount: -1000 };
  const restored = createBankTransaction('transaction-1');

  beforeEach(() => {
    seedBankViews();
    queryClient.setQueryData(bankSyncKeys.links(), [createBankLink()]);
    queryClient.setQueryData(transactionKeys.detail('transaction-1'), edited);
  });

  it('puts the restored transaction in place and refreshes the inbox, which shows its amount', () => {
    applyRestoredBankValue(queryClient, restored, 'amount');

    expect(queryClient.getQueryData(transactionKeys.detail('transaction-1'))).toEqual(restored);
    expectInvalidated([reviewKey, bankSyncKeys.bulkPreview(undefined), accountKeys.detail('account-1')], true);
    expectInvalidated([bankSyncKeys.pending('account-1'), bankSyncKeys.links(), ...statusKeys, otherAccountKey], false);
  });
});

describe('a link made or removed', () => {
  const reads: Array<{ name: string; key: QueryKey; data: unknown }> = [
    { name: 'links', key: bankSyncKeys.links(), data: [] },
    { name: 'account status', key: bankSyncKeys.accountStatus('account-1'), data: {} },
    { name: 'connections', key: bankSyncKeys.connections(), data: [] },
    { name: 'providers', key: bankSyncKeys.providers(), data: {} },
  ];

  it.each(reads.map(({ name }, held) => ({ name, held })))('settles only once the $name have refetched', async ({ held }) => {
    queryClient.setQueryData(reviewKey, {});
    const answers = reads.map(({ key, data }) => observeWithHeldRead(key, data));
    let settled = false;

    const done = refreshBankLinkState(queryClient).then(() => {
      settled = true;
    });
    await settle();

    expectInvalidated([reviewKey], true);
    for (const [index, answer] of answers.entries()) {
      if (index !== held) answer();
    }
    await settle();
    expect(settled).toBe(false);

    answers[held]();
    await done;
    expect(settled).toBe(true);
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
