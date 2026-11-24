/**
 * Tests transaction date-group helpers so calendar grouping never drops, repeats or reorders a row,
 * and a day's shown total always matches its rows
 */
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import type { Transaction } from '@/api/transactions'
import {
  getDayTotalFxStatusMessage,
  getTransactionDateGroupFxStatus,
  getTransactionDateGroupTotal,
  groupTransactionsByDate,
  isTransactionAmountUnconverted,
} from '@/components/transactions/utils/transactionDateGroups'
import type { TransactionListAccount } from '@/components/transactions/types/transactionList'
import { calendarDays, toYmd } from '@tests/utils/generators'

const fixedAccount: TransactionListAccount = { id: 'account', name: 'Checking', can_write: true, group_id: null }

// More rows than a day usually holds, so a property meets long days and many short ones
const MAX_ROWS = 60

// The frontend sums amounts as numbers, so each row stays small enough that a full day's total is
// still an exact integer. No real day comes near this, at over a trillion units a row
const MAX_ROW_AMOUNT = Math.floor(Number.MAX_SAFE_INTEGER / MAX_ROWS)

// Days the calendar does not have. The list keeps their rows under the raw text
const IMPOSSIBLE_DAYS = ['2026-02-31', '2025-02-29', '2026-04-31']

const rowAmounts = fc.option(fc.integer({ min: -MAX_ROW_AMOUNT, max: MAX_ROW_AMOUNT }))

const rowDays = fc.oneof(
  { weight: 9, arbitrary: calendarDays.map(toYmd) },
  { weight: 1, arbitrary: fc.constantFrom(...IMPOSSIBLE_DAYS) },
)

// How many days one list's rows fall on, so most days hold several rows
const MAX_DAYS = 8

/**
 * Draws a list of rows, each with its own id, one of a few days, and amounts in both currencies
 * that may be missing
 */
const transactionLists = fc
  .uniqueArray(rowDays, { minLength: 1, maxLength: MAX_DAYS })
  .chain((days) => fc.array(fc.tuple(fc.constantFrom(...days), rowAmounts, rowAmounts), { maxLength: MAX_ROWS }))
  .map((rows) =>
    rows.map(([dt, account_amount, base_currency_amount], index) =>
      createTransaction({ id: `t${index}`, dt, account_amount, base_currency_amount }),
    ),
  )

/**
 * Sums amounts as big integers, counting a missing one as nothing, so the expected total comes from
 * arithmetic that cannot round
 */
function sumExactly(amounts: (number | null)[]): number {
  return Number(amounts.reduce<bigint>((sum, amount) => sum + BigInt(amount ?? 0), 0n))
}

/**
 * Builds the transaction fields needed by date-group helper tests
 */
function createTransaction(overrides: Partial<Transaction>): Transaction {
  return {
    id: overrides.id ?? 'transaction',
    created_by_user_id: 'user',
    account_id: overrides.account_id ?? 'account',
    dt: overrides.dt ?? '2026-06-01',
    merchant_id: null,
    merchant_name: null,
    category_id: 'category',
    amount: overrides.amount ?? 0,
    account_amount: overrides.account_amount ?? null,
    base_currency_amount: overrides.base_currency_amount ?? null,
    currency: 'USD',
    fx_rate: null,
    notes: null,
    counterparty_account_id: null,
    counterparty_account_scope: null,
    refund_of_transaction_id: null,
    refund_transaction_ids: [],
    created_at: '2026-06-01T00:00:00Z',
    updated_at: '2026-06-01T00:00:00Z',
    tag_ids: [],
    tags: [],
    bank_source: null,
    ...overrides,
  }
}

describe('transaction date-group helpers', () => {
  it('keeps a transaction dated with a day the calendar does not have, under its raw heading', () => {
    const groups = groupTransactionsByDate([
      createTransaction({ id: 'impossible', dt: '2026-02-31', base_currency_amount: -500 }),
    ])

    expect(groups).toHaveLength(1)
    expect(groups[0].dateLabel).toBe('2026-02-31')
    expect(groups[0].transactions).toHaveLength(1)
  })

  it('puts 50 rows over 7 days into 7 groups headed by each day, holding all 50 in their order', () => {
    // Newest day first, as the list endpoint sorts them, with a day's rows kept together
    const transactions = Array.from({ length: 50 }, (_, index) =>
      createTransaction({ id: `t${index}`, dt: `2026-06-0${7 - Math.floor(index / 8)}` }),
    )
    const groups = groupTransactionsByDate(transactions)

    expect(groups.map((group) => group.dateLabel)).toEqual([
      'June 7, 2026',
      'June 6, 2026',
      'June 5, 2026',
      'June 4, 2026',
      'June 3, 2026',
      'June 2, 2026',
      'June 1, 2026',
    ])
    expect(groups.flatMap((group) => group.transactions)).toEqual(transactions)
  })

  it('gives back every row exactly once and in order, each under a heading shared only with its neighbours', () => {
    fc.assert(
      fc.property(transactionLists, (transactions) => {
        const groups = groupTransactionsByDate(transactions)

        expect(groups.flatMap((group) => group.transactions)).toStrictEqual(transactions)
        for (const group of groups) {
          expect(new Set(group.transactions.map((transaction) => transaction.dt)).size).toBe(1)
        }
        for (let index = 1; index < groups.length; index++) {
          expect(groups[index].dateLabel).not.toBe(groups[index - 1].dateLabel)
        }
      }),
    )
  })

  it('gives each day one group when its rows arrive sorted by day', () => {
    fc.assert(
      fc.property(transactionLists, (transactions) => {
        const sorted = transactions.toSorted((one, other) => other.dt.localeCompare(one.dt))
        const groups = groupTransactionsByDate(sorted)

        expect(groups).toHaveLength(new Set(sorted.map((transaction) => transaction.dt)).size)
      }),
    )
  })

  it('totals a day with rows of −12.50 and 30.00 as 17.50, in the currency the list totals in', () => {
    const transactions = [
      createTransaction({ base_currency_amount: -1250, account_amount: -1000 }),
      createTransaction({ base_currency_amount: 3000, account_amount: 2400 }),
    ]

    expect(getTransactionDateGroupTotal(transactions)).toBe(1750)
    expect(getTransactionDateGroupTotal(transactions, fixedAccount)).toBe(1400)
  })

  it('totals a day as the sum of its rows in the currency the list totals in, leaving out unconverted ones', () => {
    fc.assert(
      fc.property(transactionLists, fc.boolean(), (transactions, isAccountList) => {
        const shownAmounts = transactions.map((transaction) =>
          isAccountList ? transaction.account_amount : transaction.base_currency_amount,
        )

        expect(getTransactionDateGroupTotal(transactions, isAccountList ? fixedAccount : undefined)).toBe(
          sumExactly(shownAmounts),
        )
      }),
    )
  })

  it('flags a transaction whose amount in the shown currency is missing, not one that converted to zero', () => {
    const unconvertedInBase = createTransaction({ base_currency_amount: null, account_amount: 1000 })
    const zeroInBase = createTransaction({ base_currency_amount: 0, account_amount: 0 })

    expect(isTransactionAmountUnconverted(unconvertedInBase)).toBe(true)
    expect(isTransactionAmountUnconverted(unconvertedInBase, fixedAccount)).toBe(false)
    expect(isTransactionAmountUnconverted(zeroInBase)).toBe(false)
  })

  it('gives a day an FX status naming the missing currency pairs only when one of its amounts is missing', () => {
    const converted = createTransaction({ base_currency_amount: 1200 })
    const missingUsd = createTransaction({ base_currency_amount: null, currency: 'USD' })
    const missingEur = createTransaction({ base_currency_amount: null, currency: 'EUR' })
    const missingUsdAgain = createTransaction({ base_currency_amount: null, currency: 'USD' })

    expect(getTransactionDateGroupFxStatus([converted], 'CAD')).toBeNull()
    expect(getTransactionDateGroupFxStatus([converted, missingUsd, missingEur, missingUsdAgain], 'CAD')).toEqual({
      state: 'incomplete',
      missing_pairs: [
        { base: 'USD', quote: 'CAD' },
        { base: 'EUR', quote: 'CAD' },
      ],
    })
  })

  it('gives a day with an amount left out by a refused conversion the reason, and no missing pair for it', () => {
    const reason = 'This server allows no more of these'
    const withheld = createTransaction({ base_currency_amount: null, currency: 'USD', withheld_reason: reason })
    const missingEur = createTransaction({ base_currency_amount: null, currency: 'EUR' })

    expect(getTransactionDateGroupFxStatus([withheld], 'CAD')).toEqual({
      state: 'none',
      missing_pairs: [],
      withheld_reason: reason,
    })
    expect(getTransactionDateGroupFxStatus([withheld, missingEur], 'CAD')).toEqual({
      state: 'incomplete',
      missing_pairs: [{ base: 'EUR', quote: 'CAD' }],
      withheld_reason: reason,
    })
  })

  it('reads the account amount for the day status on an account list, quoting the account currency', () => {
    const missingInAccount = createTransaction({ account_amount: null, base_currency_amount: 1200, currency: 'EUR' })
    const missingOnlyInBase = createTransaction({ account_amount: 1000, base_currency_amount: null })

    expect(getTransactionDateGroupFxStatus([missingOnlyInBase], 'USD', fixedAccount)).toBeNull()
    expect(getTransactionDateGroupFxStatus([missingInAccount], 'USD', fixedAccount)).toEqual({
      state: 'incomplete',
      missing_pairs: [{ base: 'EUR', quote: 'USD' }],
    })
  })
})

describe('getDayTotalFxStatusMessage', () => {
  it('says an upcoming total waits for a published rate, and a past one could not convert', () => {
    expect(getDayTotalFxStatusMessage(true)).toBe(
      "This total leaves out amounts whose exchange rate isn't published yet",
    )
    expect(getDayTotalFxStatusMessage(false)).toContain('could not be converted')
  })
})
