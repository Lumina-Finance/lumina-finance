/**
 * Covers how the review block words and scopes waiting bank items: the line each kind asks with, the
 * amount it shows, its date, the backlog notice, and which accounts' items it reads
 *
 * These tests catch a correction naming its changed fields in another order than "amount and date",
 * a new item with an amount its currency can't hold losing decimal places or not asking for an amount,
 * a removal showing the bank's amount rather than the ledger's, a date in this year carrying its year,
 * a warning shown over a pause, accounts named out of the accounts list's order, and a scoped list
 * asking for a group or shared account's items, which the server refuses
 */
import { describe, expect, it } from 'vitest'
import type { BankReviewBacklog, BankReviewItem, BankReviewItemKind } from '@/api/bank-sync/types'
import type { Currency } from '@/api/currency'
import {
  describeBacklogNotice,
  describeReviewItem,
  formatReviewDate,
  getReviewAccountIds,
  getReviewItemAmount,
} from '@/components/transactions/utils/bankReview'
import { formatMovedCurrency } from '@/utils/formatCurrency'

const MINUS = String.fromCodePoint(0x2212)
const CURRENCIES: Currency[] = [{ id: 'USD', name: 'US Dollar', symbol: '$', minor_unit_exponent: 2 }]
const formatMoved = (amount: number, currency: string) => formatMovedCurrency(amount, currency, CURRENCIES)

/** Builds an item of the given kind on Everyday, for $12.50 out on Sep 21, 2026 */
function createItem(kind: BankReviewItemKind, overrides: Partial<BankReviewItem> = {}): BankReviewItem {
  const bank = { date: '2026-09-21', amount: -1250, raw_amount: null, description: 'COUNTDOWN 123', merchant_name: null, category_hint: null }
  return {
    id: `item-${kind}`,
    kind,
    account_id: 'everyday',
    provider: 'simplefin',
    provider_name: 'SimpleFIN',
    external_transaction_id: 'TRN-1',
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

function createBacklog(accountId: string, waiting: number, state: { paused?: boolean; warned?: boolean } = {}): BankReviewBacklog {
  return { account_id: accountId, waiting_new_count: waiting, paused: state.paused ?? false, review_warning: state.warned ?? false }
}

const EVERYDAY = { id: 'everyday', name: 'Everyday', owner_id: 'user-1', group_id: null }
const SAVINGS = { id: 'savings', name: 'Savings', owner_id: 'user-1', group_id: null }
const JOINT = { id: 'joint', name: 'Joint', owner_id: null, group_id: 'group-1' }
const SHARED = { id: 'shared', name: 'Shared', owner_id: 'user-2', group_id: null }

describe('the line under an item', () => {
  it.each([
    ['a new item', createItem('new'), 'Needs merchant and category'],
    ['a new item whose amount its currency cannot hold', createItem('new', {
      bank: { ...createItem('new').bank, amount: null, raw_amount: '-12.345' },
    }), 'Needs amount, merchant and category'],
    ['a removal', createItem('removal'), 'The bank no longer reports this transaction'],
    ['a correction to the amount', createItem('correction', { changed_fields: ['amount'] }), 'The bank changed the amount'],
    ['a correction to the date and amount', createItem('correction', { changed_fields: ['date', 'amount'] }), 'The bank changed the amount and date'],
    ['a correction to every field', createItem('correction', { changed_fields: ['description', 'date', 'amount'] }),
      'The bank changed the amount, date and bank description'],
  ])('says what %s asks', (_, item, line) => {
    expect(describeReviewItem(item)).toBe(line)
  })
})

describe('the amount an item shows', () => {
  it('shows the ledger amount a removal would take out, struck through', () => {
    expect(getReviewItemAmount(createItem('removal'), 'USD', formatMoved)).toEqual({ text: `${MINUS}$18.00`, sign: -1, isStruckThrough: true })
  })

  it('shows the bank amount of a new item, with money in signed for the positive colour', () => {
    const refund = createItem('new', { bank: { ...createItem('new').bank, amount: 4250 } })

    expect(getReviewItemAmount(refund, 'USD', formatMoved)).toEqual({ text: '+$42.50', sign: 1, isStruckThrough: false })
  })

  it('shows every decimal place the bank sent when the currency holds fewer', () => {
    const exact = createItem('new', { bank: { ...createItem('new').bank, amount: null, raw_amount: '-1234.567' } })

    expect(getReviewItemAmount(exact, 'USD', formatMoved)).toEqual({ text: `${MINUS}$1,234.567`, sign: -1, isStruckThrough: false })
  })
})

describe('the date an item shows', () => {
  it('leaves the year off a date in this year and puts it on one from another', () => {
    expect(formatReviewDate('2026-09-21', '2026-10-05')).toBe('Sep 21')
    expect(formatReviewDate('2025-12-30', '2026-01-02')).toBe('Dec 30, 2025')
  })
})

describe('the backlog notice', () => {
  it('names every paused account, in the accounts list order, over any warning', () => {
    const backlogs = [createBacklog('savings', 120, { paused: true }), createBacklog('everyday', 105, { paused: true }), createBacklog('visa', 85, { warned: true })]

    expect(describeBacklogNotice(backlogs, [EVERYDAY, SAVINGS, { id: 'visa', name: 'Visa' }])).toEqual({
      tone: 'paused',
      text: 'Paused · 105 new to review in Everyday, 120 new to review in Savings. Sync resumes at 50 or fewer.',
    })
  })

  it('warns for an account at 80 or more when none is paused', () => {
    expect(describeBacklogNotice([createBacklog('savings', 85, { warned: true }), createBacklog('everyday', 3)], [EVERYDAY, SAVINGS])).toEqual({
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

  it('reads every account for a list of every account', () => {
    expect(getReviewAccountIds(accounts, 'user-1', undefined)).toBeUndefined()
    expect(getReviewAccountIds(accounts, 'user-1', [])).toBeUndefined()
  })

  it('reads only the own personal accounts a list is filtered or fixed to', () => {
    expect(getReviewAccountIds(accounts, 'user-1', ['savings', 'joint', 'shared'])).toEqual(['savings'])
    expect(getReviewAccountIds(accounts, 'user-1', ['joint'])).toEqual([])
  })
})
