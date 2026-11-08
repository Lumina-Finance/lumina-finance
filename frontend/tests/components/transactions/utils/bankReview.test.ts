/**
 * Covers how the review block words and scopes waiting bank items: the line each kind asks with, the
 * amount it shows, its date, the backlog notice, the accounts whose items it reads, and the order
 * new items are reviewed in
 *
 * These tests catch a correction naming its changed fields in another order than "amount and date",
 * or saying nothing when it names none the block knows, a new item with an amount its currency can't
 * hold losing decimal places or not asking for an amount, a bank amount that isn't a number vanishing,
 * a removal showing the bank's amount rather than the ledger's, a date in this year carrying its year,
 * a warning shown over a pause, accounts named out of the order given, a scoped list
 * asking for a group or shared account's items (the server refuses it), Keep window open
 * going on to a correction, skipping a new item, or ending while a new item before it still waits
 */
import { describe, expect, it } from 'vitest'
import type { BankReviewBacklog, BankReviewItem, BankReviewItemKind } from '@/api/bank-sync/types'
import type { Currency } from '@/api/currency'
import {
  describeBacklogNotice,
  describeReviewItem,
  findNextNewItem,
  formatReviewDate,
  getReviewAccountIds,
  getReviewItemAmount,
} from '@/components/transactions/utils/bankReview'
import { formatMovedCurrency } from '@/utils/formatCurrency'

const MINUS = String.fromCodePoint(0x2212)
const CURRENCIES: Currency[] = [{ id: 'USD', name: 'US Dollar', symbol: '$', minor_unit_exponent: 2 }]
const formatMoved = (amount: number, currency: string) => formatMovedCurrency(amount, currency, CURRENCIES)

/** Builds an item of the given kind on Everyday, for $12.50 out on Sep 21, 2026 */
function createReviewItem(kind: BankReviewItemKind, overrides: Partial<BankReviewItem> = {}): BankReviewItem {
  const bank = { date: '2026-09-21', amount: -1250, raw_amount: null, description: 'COUNTDOWN 123' }
  return {
    id: `item-${kind}`,
    kind,
    account_id: 'everyday',
    provider: 'simplefin',
    provider_name: 'SimpleFIN',
    received_at: '2026-09-22T12:00:00Z',
    version: 1,
    bank,
    transaction_id: kind === 'new' ? null : 'transaction-1',
    current: kind === 'new' ? null : { ...bank, amount: -1800 },
    changed_fields: [],
    protected_fields: [],
    ...overrides,
  }
}

function createBacklog(
  accountId: string,
  waiting: number,
  state: { paused?: boolean; warned?: boolean } = {},
): BankReviewBacklog {
  return {
    account_id: accountId,
    waiting_new_count: waiting,
    paused: state.paused ?? false,
    review_warning: state.warned ?? false,
  }
}

const EVERYDAY = { id: 'everyday', name: 'Everyday', owner_id: 'user-1', group_id: null }
const SAVINGS = { id: 'savings', name: 'Savings', owner_id: 'user-1', group_id: null }
const JOINT = { id: 'joint', name: 'Joint', owner_id: null, group_id: 'group-1' }
const SHARED = { id: 'shared', name: 'Shared', owner_id: 'user-2', group_id: null }

describe('the line under an item', () => {
  it.each([
    ['a new item', createReviewItem('new'), 'Needs merchant and category'],
    [
      'a new item whose amount its currency cannot hold',
      createReviewItem('new', {
        bank: { ...createReviewItem('new').bank, amount: null, raw_amount: '-12.345' },
      }),
      'Needs amount, merchant and category',
    ],
    ['a removal', createReviewItem('removal'), 'The bank no longer reports this transaction'],
    [
      'a correction to the amount',
      createReviewItem('correction', { changed_fields: ['amount'] }),
      'The bank changed the amount',
    ],
    [
      'a correction to the date and amount',
      createReviewItem('correction', { changed_fields: ['date', 'amount'] }),
      'The bank changed the amount and date',
    ],
    [
      'a correction to every field',
      createReviewItem('correction', { changed_fields: ['description', 'date', 'amount'] }),
      'The bank changed the amount, date and bank description',
    ],
    [
      'a correction naming no field it knows',
      createReviewItem('correction', { changed_fields: [] }),
      'The bank changed this transaction',
    ],
  ])('says what %s asks', (_, item, line) => {
    expect(describeReviewItem(item)).toBe(line)
  })
})

describe('the amount an item shows', () => {
  it('shows the ledger amount a removal would take out, struck through', () => {
    expect(getReviewItemAmount(createReviewItem('removal'), 'USD', formatMoved)).toEqual({
      text: `${MINUS}$18.00`,
      sign: -1,
      isStruckThrough: true,
    })
  })

  it('shows the bank amount of a new item, with money in signed for the positive colour', () => {
    const refund = createReviewItem('new', { bank: { ...createReviewItem('new').bank, amount: 4250 } })

    expect(getReviewItemAmount(refund, 'USD', formatMoved)).toEqual({
      text: '+$42.50',
      sign: 1,
      isStruckThrough: false,
    })
  })

  it('shows every decimal place the bank sent when the currency holds fewer', () => {
    const exact = createReviewItem('new', {
      bank: { ...createReviewItem('new').bank, amount: null, raw_amount: '-1234.567' },
    })

    expect(getReviewItemAmount(exact, 'USD', formatMoved)).toEqual({
      text: `${MINUS}$1,234.567`,
      sign: -1,
      isStruckThrough: false,
    })
  })

  it('shows a bank amount that is not a number as it came, unsigned', () => {
    const unreadable = createReviewItem('new', {
      bank: { ...createReviewItem('new').bank, amount: null, raw_amount: 'about 12' },
    })

    expect(getReviewItemAmount(unreadable, 'USD', formatMoved)).toEqual({
      text: 'about 12',
      sign: 0,
      isStruckThrough: false,
    })
  })
})

describe('the date an item shows', () => {
  it('leaves the year off a date in this year and puts it on one from another', () => {
    expect(formatReviewDate('2026-09-21', '2026-10-05')).toBe('Sep 21')
    expect(formatReviewDate('2025-12-30', '2026-01-02')).toBe('Dec 30, 2025')
  })
})

describe('the backlog notice', () => {
  it('names every paused account, in the order the accounts are given, over any warning', () => {
    const backlogs = [
      createBacklog('savings', 120, { paused: true }),
      createBacklog('everyday', 105, { paused: true }),
      createBacklog('visa', 85, { warned: true }),
    ]

    expect(describeBacklogNotice(backlogs, [EVERYDAY, SAVINGS, { id: 'visa', name: 'Visa' }])).toEqual({
      tone: 'paused',
      text: 'Paused · 105 new to review in Everyday, 120 new to review in Savings. Sync resumes at 50 or fewer.',
    })
  })

  it('warns for an account at 80 or more when none is paused', () => {
    expect(
      describeBacklogNotice(
        [createBacklog('savings', 85, { warned: true }), createBacklog('everyday', 3)],
        [EVERYDAY, SAVINGS],
      ),
    ).toEqual({
      tone: 'warning',
      text: '85 new to review in Savings. Sync pauses at 100.',
    })
  })

  it('says nothing when no account is paused or warned, or the one that is is out of scope', () => {
    expect(describeBacklogNotice([createBacklog('everyday', 79)], [EVERYDAY])).toBeNull()
    expect(describeBacklogNotice([createBacklog('everyday', 105, { paused: true })], [SAVINGS])).toBeNull()
  })
})

describe('the accounts whose items the block reads', () => {
  const accounts = [EVERYDAY, SAVINGS, JOINT, SHARED]

  const linked = new Set(['everyday', 'savings', 'joint'])

  it('reads every account for a list of every account', () => {
    expect(getReviewAccountIds(accounts, 'user-1', undefined, linked)).toBeUndefined()
    expect(getReviewAccountIds(accounts, 'user-1', [], linked)).toBeUndefined()
  })

  it('reads only the own personal accounts a list is filtered or fixed to', () => {
    expect(getReviewAccountIds(accounts, 'user-1', ['savings', 'joint', 'shared'], linked)).toEqual(['savings'])
    expect(getReviewAccountIds(accounts, 'user-1', ['joint'], linked)).toEqual([])
  })

  it('reads only the linked accounts a list is filtered or fixed to', () => {
    expect(getReviewAccountIds(accounts, 'user-1', ['everyday', 'savings'], new Set(['savings']))).toEqual(['savings'])
  })

  it('reads nothing for a user with no linked account', () => {
    expect(getReviewAccountIds(accounts, 'user-1', undefined, new Set())).toEqual([])
    expect(getReviewAccountIds(accounts, 'user-1', ['everyday'], new Set())).toEqual([])
  })
})

describe('the new item reviewed after another', () => {
  const first = createReviewItem('new', { id: 'first' })
  const correction = createReviewItem('correction', { id: 'correction' })
  const middle = createReviewItem('new', { id: 'middle' })
  const removal = createReviewItem('removal', { id: 'removal' })
  const last = createReviewItem('new', { id: 'last' })
  const items = [first, correction, middle, removal, last]

  it('is the next new item in the block, passing over corrections and removals', () => {
    expect(findNextNewItem(items, 'first')).toBe(middle)
    expect(findNextNewItem(items, 'middle')).toBe(last)
  })

  it('goes back to the first new item before it once none follows', () => {
    expect(findNextNewItem(items, 'last')).toBe(first)
    expect(findNextNewItem([correction, middle, last], 'last')).toBe(middle)
  })

  it('is none when no other new item is loaded', () => {
    expect(findNextNewItem([correction, last, removal], 'last')).toBeNull()
  })
})
