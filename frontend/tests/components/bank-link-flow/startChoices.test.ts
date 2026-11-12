/**
 * Tests the start dates the link flow offers and the gap it warns about, so a rewrite catches a
 * month choice raised to the account's own transactions again, the same day offered twice, a choice
 * offered outside the range, or a gap reported where the import picks up right after the account's
 * own transactions
 */
import { describe, expect, it } from 'vitest'
import type { BankImportRange } from '@/api/bank-sync'
import {
  AFTER_LATEST_START,
  describeEndRefusal,
  describeStartRefusal,
  findUncoveredUntil,
  listStartChoices,
} from '@/components/bank-link-flow/startChoices'

// Today is Oct 5, 2026, with a provider reaching 12 months back to Oct 1, 2025 and an empty account
const EMPTY_ACCOUNT: BankImportRange = {
  earliest_allowed: '2025-10-01',
  latest_allowed: '2026-10-05',
  ledger_floor: null,
  provider_limit_date: '2025-10-01',
  provider_history_months: 12,
}

// The account's latest transaction is May 14. An import may still start anywhere the provider reaches
const ACCOUNT_WITH_HISTORY: BankImportRange = { ...EMPTY_ACCOUNT, ledger_floor: '2026-05-15' }

describe('bank link start choices', () => {
  it('offers 3 and 6 months and the provider limit, each from the first of its month', () => {
    expect(listStartChoices(EMPTY_ACCOUNT, 'Everyday')).toEqual([
      { key: '3', label: '3 months', date: '2026-07-01' },
      { key: '6', label: '6 months', date: '2026-04-01' },
      { key: '12', label: '12 months', date: '2025-10-01' },
    ])
  })

  it('leaves out the shorter choices a provider limit reaches no further than', () => {
    const fourMonths = {
      ...EMPTY_ACCOUNT,
      earliest_allowed: '2026-06-01',
      provider_limit_date: '2026-06-01',
      provider_history_months: 4,
    }
    const threeMonths = {
      ...EMPTY_ACCOUNT,
      earliest_allowed: '2026-07-01',
      provider_limit_date: '2026-07-01',
      provider_history_months: 3,
    }

    expect(listStartChoices(fourMonths, 'Everyday').map((choice) => [choice.label, choice.date])).toEqual([
      ['3 months', '2026-07-01'],
      ['4 months', '2026-06-01'],
    ])
    expect(listStartChoices(threeMonths, 'Everyday').map((choice) => [choice.label, choice.date])).toEqual([
      ['3 months', '2026-07-01'],
    ])
  })

  it("offers the day after the account's own transactions as a choice of its own, in date order, beside every month choice", () => {
    expect(listStartChoices(ACCOUNT_WITH_HISTORY, 'Everyday')).toEqual([
      { key: '3', label: '3 months', date: '2026-07-01' },
      {
        key: AFTER_LATEST_START,
        label: 'After the latest transaction',
        date: '2026-05-15',
        note: "From the day after Everyday's latest transaction",
      },
      { key: '6', label: '6 months', date: '2026-04-01' },
      { key: '12', label: '12 months', date: '2025-10-01' },
    ])
  })

  it('offers the day after the latest transaction once when a month choice lands on it', () => {
    const onTheFirst = { ...ACCOUNT_WITH_HISTORY, ledger_floor: '2026-07-01' }

    expect(listStartChoices(onTheFirst, 'Everyday').map((choice) => choice.key)).toEqual(['3', '6', '12'])
  })

  it('leaves the day after the latest transaction out when it falls after today or before the limit', () => {
    const coveredToday = { ...EMPTY_ACCOUNT, ledger_floor: '2026-10-06' }
    const coveredLongAgo = { ...EMPTY_ACCOUNT, ledger_floor: '2024-03-11' }

    expect(listStartChoices(coveredToday, 'Everyday').map((choice) => choice.key)).toEqual(['3', '6', '12'])
    expect(listStartChoices(coveredLongAgo, 'Everyday').map((choice) => choice.key)).toEqual(['3', '6', '12'])
  })
})

describe('days the range refuses as an import start', () => {
  it('says where an import can start for a day before the range', () => {
    expect(describeStartRefusal(EMPTY_ACCOUNT, '2025-09-30')).toBe('The earliest start is Oct 1, 2025')
  })

  it('says the latest start for a day after the range', () => {
    expect(describeStartRefusal(EMPTY_ACCOUNT, '2026-10-06')).toBe('The latest start is Oct 5, 2026')
  })

  it('gives no reason for either end of the range or a day between', () => {
    expect(describeStartRefusal(EMPTY_ACCOUNT, '2025-10-01')).toBeNull()
    expect(describeStartRefusal(EMPTY_ACCOUNT, '2026-02-03')).toBeNull()
    expect(describeStartRefusal(EMPTY_ACCOUNT, '2026-10-05')).toBeNull()
  })
})

describe('days the range refuses as a date range end', () => {
  it('says where an import can start for a day before the range, and the latest end for a day after it', () => {
    expect(describeEndRefusal(EMPTY_ACCOUNT, '2025-09-30')).toBe('The earliest start is Oct 1, 2025')
    expect(describeEndRefusal(EMPTY_ACCOUNT, '2026-10-06')).toBe('The latest end is Oct 5, 2026')
  })

  it('gives no reason for either end of the range', () => {
    expect(describeEndRefusal(EMPTY_ACCOUNT, '2025-10-01')).toBeNull()
    expect(describeEndRefusal(EMPTY_ACCOUNT, '2026-10-05')).toBeNull()
  })
})

describe('days left uncovered by a bank import', () => {
  it('runs from the day after the latest transaction to the day before a later start', () => {
    expect(findUncoveredUntil(ACCOUNT_WITH_HISTORY, '2026-07-01')).toBe('2026-06-30')
  })

  it('is nothing when the import picks up the day after the latest transaction', () => {
    expect(findUncoveredUntil(ACCOUNT_WITH_HISTORY, '2026-05-15')).toBeNull()
  })

  it('is nothing for an account with no transactions of its own', () => {
    expect(findUncoveredUntil(EMPTY_ACCOUNT, '2026-07-01')).toBeNull()
  })

  it('is nothing while the start is not a real date, though it sorts after the latest transaction', () => {
    expect(findUncoveredUntil(ACCOUNT_WITH_HISTORY, '2026-09-31')).toBeNull()
  })
})
