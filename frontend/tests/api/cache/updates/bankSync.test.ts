/**
 * Covers the cache writes behind bank sync: the polled link list, review decisions, bulk approval, a
 * restored bank value, a link made or removed, and account deletion. A Sync now answer is covered
 * with the link list read
 *
 * These tests catch a polled link list that changed nothing refetching every bank view, a first read
 * taken for every link appearing at once, a sync that
 * brought in data leaving the review inbox, pending rows, transaction lists or the account's balance
 * stale, a link moved to Choose bank account or removed leaving its cleared pending rows on screen, a
 * stop leaving the review pause or warning on the backlog notice, a decided item staying in a later page or its count, an item leaving the inbox before its
 * transaction shows in the list or the backlog notice counts it out, a decision that left the ledger
 * alone reloading it or taking its item out before both the links and the backlogs have refetched, a
 * kept removal taking out the correction it reopened or leaving it named a removal, bulk approval
 * taking out an item it left waiting, leaving its count too high for an applied item on a page not
 * loaded yet or never reading the inbox again for the items left waiting, a restored bank value leaving the inbox showing the ledger value it replaced or the balance panel's ledger stale, a link change settling
 * before the views that show it have refetched, and a deleted account's items lingering in a cached
 * bulk approval preview, or its own bank views asking about it again while its page still shows them
 */
import { QueryClient, QueryObserver, type InfiniteData, type QueryKey } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { BankReviewCounts, BankReviewItem, BankReviewPage } from '@/api/bank-sync/types'
import { accountKeys, bankSyncKeys, transactionKeys } from '@/api/cache/queryKeys'
import {
  applyBankLinkChanges,
  applyBulkApprovalOutcome,
  applyLedgerReviewOutcome,
  applyRestoredBankValue,
  applyReviewDecision,
  clearDeletedAccountBankData,
  forgetDeletedAccountBankData,
  refreshBankLinkState,
  removeReviewItemsFromPages,
} from '@/api/cache/updates/bankSync'
import type { Transaction } from '@/api/transactions/types'
import { createBacklog, createBankLink, createBankTransaction, createReviewItem } from './fixtures'

type CachedReviewPages = InfiniteData<BankReviewPage, string | null>

let queryClient: QueryClient
let unsubscribes: Array<() => void> = []

beforeEach(() => {
  queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false } } })
})

afterEach(() => {
  for (const unsubscribe of unsubscribes) unsubscribe()
  unsubscribes = []
  queryClient.clear()
})

const statusKeys: QueryKey[] = [
  bankSyncKeys.accountStatus('account-1'),
  bankSyncKeys.connections(),
  bankSyncKeys.providers(),
]
const backlogKey = bankSyncKeys.reviewBacklogs(undefined)
const reviewKeys: QueryKey[] = [bankSyncKeys.reviewItems(undefined), backlogKey, bankSyncKeys.bulkPreview(undefined)]
const pendingKey = bankSyncKeys.pending(['account-1'])
const ledgerKeys: QueryKey[] = [transactionKeys.list({}), accountKeys.detail('account-1')]
const otherAccountKey = accountKeys.detail('account-2')
const reviewKey = bankSyncKeys.reviewItems(undefined)

/** Seeds one cached query under every key the polled link list can make stale */
function seedBankViews(): void {
  for (const key of [...statusKeys, ...reviewKeys, pendingKey, ...ledgerKeys, otherAccountKey]) {
    queryClient.setQueryData(key, {})
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
  })
}

function reviewItemIds(): string[] {
  return (
    queryClient
      .getQueryData<CachedReviewPages>(reviewKey)
      ?.pages.flatMap((page) => page.items.map((item) => item.id)) ?? []
  )
}

/**
 * Keeps a query on screen, the way a mounted view would, with a read that answers only when the test
 * says, so a caller waiting on the refetch can be caught waiting
 */
function observeWithHeldRead(key: QueryKey, data: unknown): () => void {
  let answer: () => void = () => {}
  const read = new Promise<unknown>((resolve) => {
    answer = () => resolve(data)
  })
  queryClient.setQueryData(key, data)
  const observer = new QueryObserver(queryClient, { queryKey: key, queryFn: () => read, staleTime: Infinity })
  unsubscribes.push(observer.subscribe(() => {}))
  return answer
}

/** Lets pending promise callbacks run */
function settle(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

function expectInvalidated(keys: QueryKey[], invalidated: boolean): void {
  for (const key of keys) {
    expect(queryClient.getQueryState(key)?.isInvalidated, JSON.stringify(key)).toBe(invalidated)
  }
}

describe('a polled change in the link list', () => {
  const before = [createBankLink(), createBankLink({ account_id: 'account-2' })]

  beforeEach(seedBankViews)

  it('refreshes nothing when the links read the same as before', () => {
    applyBankLinkChanges(
      queryClient,
      before,
      before.map((link) => ({ ...link })),
    )

    expectInvalidated([...statusKeys, ...reviewKeys, pendingKey, ...ledgerKeys], false)
  })

  it.each([
    ['the first read, with no list before it', undefined, before],
    ['a list that has gone from the cache', before, undefined],
  ])('refreshes nothing for %s', (_, previous, next) => {
    applyBankLinkChanges(queryClient, previous, next)

    expectInvalidated([...statusKeys, ...reviewKeys, pendingKey, ...ledgerKeys], false)
  })

  // A move to Choose bank account and a removal each clear the link's pending rows without bringing
  // in data
  it.each([
    [
      'a sync fails',
      [
        createBankLink({
          sync: {
            ...before[0].sync,
            state: 'retrying',
            last_failure: { at: '2026-10-01T00:00:00Z', reason: 'Bank unavailable' },
          },
        }),
        before[1],
      ],
    ],
    [
      'a link moves to Choose bank account',
      [
        createBankLink({
          state: 'choose_account',
          sync: { ...before[0].sync, state: 'choose_account', next_attempt_at: null },
        }),
        before[1],
      ],
    ],
    ['a link is removed elsewhere', [before[0]]],
  ])('refreshes the status and the pending strip, leaving the inbox and the ledger, when %s', (_, after) => {
    applyBankLinkChanges(queryClient, before, after)

    expectInvalidated([...statusKeys, pendingKey], true)
    expectInvalidated([...reviewKeys, ...ledgerKeys], false)
  })

  // The server clears the pause and the warning once only the user can restart the sync
  it.each([
    [
      'a rejected connection ends its warning',
      { review_warning: true },
      { state: 'reconnect_needed', next_attempt_at: null },
    ],
    ['a bank sign-in ends its pause', { state: 'paused', paused: true }, { state: 'bank_signin_needed' }],
  ] as const)('refreshes the backlog notice, leaving the inbox and the ledger, when %s', (_, held, stopped) => {
    const holding = [createBankLink({ sync: { ...before[0].sync, waiting_new_count: 110, ...held } }), before[1]]
    const stopping = [createBankLink({ sync: { ...before[0].sync, waiting_new_count: 110, ...stopped } }), before[1]]

    applyBankLinkChanges(queryClient, holding, stopping)

    expectInvalidated([...statusKeys, backlogKey, pendingKey], true)
    expectInvalidated([reviewKey, bankSyncKeys.bulkPreview(undefined), ...ledgerKeys], false)
  })

  it('refreshes the inbox, the pending strip, the ledger and the synced account when a sync brings in data', () => {
    const after = [createBankLink({ sync: { ...before[0].sync, last_success_at: '2026-10-01T00:00:00Z' } }), before[1]]

    applyBankLinkChanges(queryClient, before, after)

    expectInvalidated([...statusKeys, ...reviewKeys, pendingKey, ...ledgerKeys], true)
    expectInvalidated([otherAccountKey], false)
  })

  it('refreshes the inbox when an import finishes another part', () => {
    const progress = {
      kind: 'initial',
      state: 'running',
      requested_start: '2025-01-01',
      windows_total: 6,
      windows_done: 2,
      items_found: 40,
      earliest_returned_date: null,
    } as const
    const importing = [createBankLink({ import: progress }), before[1]]
    const advanced = [createBankLink({ import: { ...progress, windows_done: 3, items_found: 55 } }), before[1]]

    applyBankLinkChanges(queryClient, importing, advanced)

    expectInvalidated([...reviewKeys, pendingKey], true)
  })
})

describe('decided review items', () => {
  beforeEach(seedReviewPages)

  it('leave every cached page, and every page count, while the cursors stay', () => {
    removeReviewItemsFromPages(queryClient, (item) => item.id === 'item-1' || item.id === 'item-4')

    const data = queryClient.getQueryData<CachedReviewPages>(reviewKey)
    expect(data?.pages.map((page) => page.items.map((item) => item.id))).toEqual([['item-2'], ['item-3']])
    expect(data?.pages.map((page) => page.counts)).toEqual([
      { new: 2, correction: 0, removal: 0 },
      { new: 2, correction: 0, removal: 0 },
    ])
    expect(data?.pages.map((page) => page.next_cursor)).toEqual(['cursor-2', null])
    expect(data?.pageParams).toEqual([null, 'cursor-2'])
  })

  it('leave the cached list untouched when none of them is cached', () => {
    const cached = queryClient.getQueryData(reviewKey)

    removeReviewItemsFromPages(queryClient, (item) => item.id === 'item-9')

    expect(queryClient.getQueryData(reviewKey)).toBe(cached)
  })

  it('leave the cached backlogs, which hold no pages, as they were', () => {
    const backlogs = [createBacklog()]
    queryClient.setQueryData(backlogKey, backlogs)

    removeReviewItemsFromPages(queryClient, (item) => item.id === 'item-1')

    expect(queryClient.getQueryData(backlogKey)).toBe(backlogs)
  })
})

describe('a review decision that wrote to the ledger', () => {
  beforeEach(() => {
    seedBankViews()
    seedReviewPages()
  })

  it('takes the item out of the inbox only once the transaction list and the backlogs have refetched', async () => {
    const answerTransactions = observeWithHeldRead(transactionKeys.list({ account_id: 'account-1' }), [])
    const answerLinks = observeWithHeldRead(bankSyncKeys.links(), [createBankLink()])
    const answerBacklogs = observeWithHeldRead(backlogKey, [createBacklog()])

    const done = applyLedgerReviewOutcome(queryClient, ['account-1'], (item) => item.id === 'item-1')
    await settle()

    expect(reviewItemIds()).toContain('item-1')

    answerTransactions()
    answerLinks()
    await settle()

    // The backlog notice would otherwise count an item the block no longer shows
    expect(reviewItemIds()).toContain('item-1')

    answerBacklogs()
    await done

    expect(reviewItemIds()).toEqual(['item-2', 'item-3', 'item-4'])
    expectInvalidated([...statusKeys, bankSyncKeys.bulkPreview(undefined), accountKeys.detail('account-1')], true)
    expectInvalidated([otherAccountKey], false)
  })
})

describe('bulk approval', () => {
  const skipped = createReviewItem('item-7', 'correction')
  const applied = [
    createReviewItem('item-4', 'correction'),
    createReviewItem('item-5', 'removal'),

    // On a page not loaded yet
    createReviewItem('item-6', 'correction'),
  ]
  const accountScopeKey = bankSyncKeys.reviewItems(['account-1'])

  const pagesOf = (items: BankReviewItem[], counts: BankReviewCounts): CachedReviewPages => ({
    pages: [{ items, counts, next_cursor: 'cursor-2' }],
    pageParams: [null],
  })
  const pagesIn = (key: QueryKey) =>
    queryClient
      .getQueryData<CachedReviewPages>(key)
      ?.pages.map((page) => [page.items.map((item) => item.id), page.counts])

  beforeEach(seedBankViews)

  it('takes the applied items out once the transaction list and the backlogs have refetched, settling before the inbox is read again', async () => {
    const answerTransactions = observeWithHeldRead(transactionKeys.list({ account_id: 'account-1' }), [])
    const answerLinks = observeWithHeldRead(bankSyncKeys.links(), [createBankLink()])
    const answerBacklogs = observeWithHeldRead(backlogKey, [createBacklog()])
    const changedSince = { ...skipped, version: 2 }
    const answerReview = observeWithHeldRead(
      reviewKey,
      pagesOf([createReviewItem('item-1', 'new'), changedSince], { new: 1, correction: 1, removal: 0 }),
    )
    queryClient.setQueryData(
      reviewKey,
      pagesOf([createReviewItem('item-1', 'new'), skipped, applied[0], applied[1]], {
        new: 1,
        correction: 3,
        removal: 1,
      }),
    )
    queryClient.setQueryData(
      accountScopeKey,
      pagesOf([createReviewItem('item-1', 'new'), applied[0]], { new: 1, correction: 2, removal: 0 }),
    )

    const done = applyBulkApprovalOutcome(queryClient, undefined, applied)
    answerTransactions()
    answerLinks()
    await settle()

    expect(reviewItemIds()).toContain('item-4')

    answerBacklogs()
    await done

    // The scope previewed counts out the applied item no loaded page holds too, and one cached from
    // before only the items it holds, until it is read again when next shown
    expect(pagesIn(reviewKey)).toEqual([[['item-1', 'item-7'], { new: 1, correction: 1, removal: 0 }]])
    expect(pagesIn(accountScopeKey)).toEqual([[['item-1'], { new: 1, correction: 1, removal: 0 }]])
    expectInvalidated(
      [...statusKeys, accountScopeKey, bankSyncKeys.bulkPreview(undefined), accountKeys.detail('account-1')],
      true,
    )
    expectInvalidated([otherAccountKey], false)

    answerReview()
    await settle()

    // The correction left waiting shows what the bank sent since the preview
    expect(queryClient.getQueryData<CachedReviewPages>(reviewKey)?.pages[0].items).toEqual([
      createReviewItem('item-1', 'new'),
      changedSince,
    ])
  })
})

describe('a review decision that left the ledger alone', () => {
  const waiting = createBankTransaction('transaction-item-4', 'item-4')
  const kept = createBankTransaction('transaction-item-4')

  let answerLinks: () => void
  let answerBacklogs: () => void

  beforeEach(() => {
    seedReviewPages()
    answerLinks = observeWithHeldRead(bankSyncKeys.links(), [createBankLink()])
    answerBacklogs = observeWithHeldRead(backlogKey, [createBacklog()])
    queryClient.setQueryData(bankSyncKeys.bulkPreview(undefined), {})
    for (const key of statusKeys) queryClient.setQueryData(key, {})
    queryClient.setQueryData(transactionKeys.list({}), [waiting])
  })

  it.each(['links', 'backlogs'] as const)(
    'puts the kept transaction in place once the links and the backlogs have both refetched, the %s answering first, without reloading the ledger',
    async (first) => {
      const done = applyReviewDecision(queryClient, (item) => item.id === 'item-4', kept)
      const [answerFirst, answerSecond] =
        first === 'links' ? [answerLinks, answerBacklogs] : [answerBacklogs, answerLinks]
      answerFirst()
      await settle()

      // The waiting count the other read carries would otherwise still include an item the block no
      // longer shows, in the sync status for the links and in the backlog notice for the backlogs,
      // beside a marker that has already cleared
      expect(reviewItemIds()).toContain('item-4')
      expect(queryClient.getQueryData<Transaction[]>(transactionKeys.list({}))).toEqual([waiting])

      answerSecond()
      await done

      expect(queryClient.getQueryData<Transaction[]>(transactionKeys.list({}))).toEqual([kept])
      expect(reviewItemIds()).toEqual(['item-1', 'item-2', 'item-3'])
      expectInvalidated([...statusKeys, bankSyncKeys.bulkPreview(undefined)], true)
      expectInvalidated([transactionKeys.list({})], false)
    },
  )

  it('keeps a removal whose kept transaction still names it as waiting, settling once the inbox reads it as the correction it reopened', async () => {
    const pagesWith = (item: ReturnType<typeof createReviewItem>): CachedReviewPages => ({
      pages: [
        {
          items: [createReviewItem('item-1', 'new'), item],
          counts: { new: 1, correction: 0, removal: 0, [item.kind]: 1 },
          next_cursor: null,
        },
      ],
      pageParams: [null],
    })
    const answerReview = observeWithHeldRead(reviewKey, pagesWith(createReviewItem('item-4', 'correction')))
    queryClient.setQueryData(reviewKey, pagesWith(createReviewItem('item-4', 'removal')))

    let isSettled = false
    const done = applyReviewDecision(queryClient, (item) => item.id === 'item-4', waiting).then(() => {
      isSettled = true
    })
    answerLinks()
    answerBacklogs()
    await settle()

    // Settling now would toast the kept transaction beside a row still offering to remove it
    expect(isSettled).toBe(false)

    answerReview()
    await done

    const items = queryClient.getQueryData<CachedReviewPages>(reviewKey)?.pages.flatMap((page) => page.items)
    expect(items?.map((item) => [item.id, item.kind])).toEqual([
      ['item-1', 'new'],
      ['item-4', 'correction'],
    ])
    expect(queryClient.getQueryData<Transaction[]>(transactionKeys.list({}))).toEqual([waiting])
  })

  it('settles a dismissed item, which answers with no transaction, leaving the ledger as it was', async () => {
    const done = applyReviewDecision(queryClient, (item) => item.id === 'item-1', undefined)
    answerLinks()
    answerBacklogs()
    await done

    expect(queryClient.getQueryData<Transaction[]>(transactionKeys.list({}))).toEqual([waiting])
    expect(reviewItemIds()).toEqual(['item-2', 'item-3', 'item-4'])
  })
})

describe('a restored bank value', () => {
  const edited = { ...createBankTransaction('transaction-1'), amount: -1000 }
  const restored = createBankTransaction('transaction-1')

  beforeEach(() => {
    seedBankViews()
    queryClient.setQueryData(bankSyncKeys.links(), [createBankLink()])
    queryClient.setQueryData(transactionKeys.detail('transaction-1'), edited)
  })

  it('puts the restored transaction in place and refreshes the inbox, which shows its amount, and the balance panel', () => {
    applyRestoredBankValue(queryClient, restored, 'amount')

    expect(queryClient.getQueryData(transactionKeys.detail('transaction-1'))).toEqual(restored)
    expectInvalidated(
      [
        reviewKey,
        bankSyncKeys.bulkPreview(undefined),
        accountKeys.detail('account-1'),
        bankSyncKeys.accountStatus('account-1'),
      ],
      true,
    )
    expectInvalidated(
      [pendingKey, bankSyncKeys.links(), bankSyncKeys.connections(), bankSyncKeys.providers(), otherAccountKey],
      false,
    )
  })
})

describe('a link made or removed', () => {
  const reads: Array<{ name: string; key: QueryKey; data: unknown }> = [
    { name: 'links', key: bankSyncKeys.links(), data: [] },
    { name: 'account status', key: bankSyncKeys.accountStatus('account-1'), data: {} },
    { name: 'connections', key: bankSyncKeys.connections(), data: [] },
    { name: 'providers', key: bankSyncKeys.providers(), data: {} },
  ]

  it.each(reads.map(({ name }, held) => ({ name, held })))(
    'settles only once the $name have refetched',
    async ({ held }) => {
      queryClient.setQueryData(reviewKey, {})
      const answers = reads.map(({ key, data }) => observeWithHeldRead(key, data))
      let settled = false

      const done = refreshBankLinkState(queryClient).then(() => {
        settled = true
      })
      await settle()

      expectInvalidated([reviewKey], true)
      for (const [index, answer] of answers.entries()) {
        if (index !== held) answer()
      }
      await settle()
      expect(settled).toBe(false)

      answers[held]()
      await done
      expect(settled).toBe(true)
    },
  )
})

describe('a deleted account', () => {
  it('drops any cached bulk approval preview and refreshes the rest of bank sync', () => {
    queryClient.setQueryData(bankSyncKeys.bulkPreview(undefined), {})
    queryClient.setQueryData(bankSyncKeys.links(), [createBankLink()])

    clearDeletedAccountBankData(queryClient, 'account-1')

    expect(queryClient.getQueryState(bankSyncKeys.bulkPreview(undefined))).toBeUndefined()
    expectInvalidated([bankSyncKeys.links()], true)
  })

  it('asks nothing more about it for the views its page still shows and drops the ones nothing shows', () => {
    const shown = [
      bankSyncKeys.accountStatus('account-1'),
      bankSyncKeys.reviewItems(['account-1']),
      bankSyncKeys.pending(['account-1']),
    ]
    for (const key of shown) observeWithHeldRead(key, {})
    queryClient.setQueryData(bankSyncKeys.reviewPreferences('account-1'), {})
    queryClient.setQueryData(bankSyncKeys.pending(['account-2']), {})

    clearDeletedAccountBankData(queryClient, 'account-1')

    expectInvalidated(shown, false)
    expect(queryClient.getQueryState(bankSyncKeys.reviewPreferences('account-1'))).toBeUndefined()
    expectInvalidated([bankSyncKeys.pending(['account-2'])], true)
  })

  it('forgets its bank views once its page leaves', () => {
    queryClient.setQueryData(bankSyncKeys.accountStatus('account-1'), {})
    queryClient.setQueryData(bankSyncKeys.accountStatus('account-2'), {})

    forgetDeletedAccountBankData(queryClient, 'account-1')

    expect(queryClient.getQueryState(bankSyncKeys.accountStatus('account-1'))).toBeUndefined()
    expect(queryClient.getQueryState(bankSyncKeys.accountStatus('account-2'))).toBeDefined()
  })
})
