/**
 * Tests the start dates the link flow offers and the gap it warns about, so a rewrite catches a
 * choice reaching into days the account already covers, the same day offered twice, or a gap
 * reported where the import picks up right after the account's own transactions
 */
import { describe, expect, it } from 'vitest'
import type { BankImportRange } from '@/api/bank-sync'
import { findUncoveredUntil, listStartChoices } from '@/components/bank-link-flow/startChoices'

// Today is Oct 5, 2026, with a provider reaching 12 months back to Oct 1, 2025 and an empty account
const EMPTY_ACCOUNT: BankImportRange = {
  suggested_start: '2026-07-01',
  default_suggestion: '2026-07-01',
  earliest_allowed: '2025-10-01',
  latest_allowed: '2026-10-05',
  ledger_floor: null,
  provider_limit_date: '2025-10-01',
  provider_history_months: 12,
  latest_ledger_date: null,
}

// The account's latest transaction is May 14, so the import may start no earlier than May 15
const ACCOUNT_WITH_HISTORY: BankImportRange = {
  ...EMPTY_ACCOUNT,
  suggested_start: '2026-07-01',
  earliest_allowed: '2026-05-15',
  ledger_floor: '2026-05-15',
  latest_ledger_date: '2026-05-14',
}

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

  it("raises a choice reaching into the account's own transactions to the day after them, once", () => {
    expect(listStartChoices(ACCOUNT_WITH_HISTORY, 'Everyday')).toEqual([
      { key: '3', label: '3 months', date: '2026-07-01' },
      {
        key: '6',
        label: 'After the latest transaction',
        date: '2026-05-15',
        note: 'Picks up the day after the latest transaction in Everyday',
      },
    ])
  })

  it('offers only the day after a transaction dated today when every choice reaches before it', () => {
    const coveredToday = {
      ...ACCOUNT_WITH_HISTORY,
      earliest_allowed: '2026-10-06',
      latest_allowed: '2026-10-06',
      ledger_floor: '2026-10-06',
    }

    expect(listStartChoices(coveredToday, 'Everyday').map((choice) => [choice.label, choice.date])).toEqual([
      ['After the latest transaction', '2026-10-06'],
    ])
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
