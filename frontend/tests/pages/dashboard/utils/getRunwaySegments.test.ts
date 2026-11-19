/**
 * Tests the runway bar segments, so the widths and positions of the account bars cannot drift from the
 * balances behind them, and the bar always fills its track from the largest account down
 *
 * Two of the four accounts in the worked example get no bar. The archived one is dropped by the
 * helper's own check, and the revolving one is dropped for having no balance recorded against it rather
 * than for its kind, since liabilities are already filtered out before this helper sees them
 */
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import type { RunwayResult } from '@/api/user'
import { getRunwaySegments } from '@/pages/dashboard/utils/getRunwaySegments'
import { signedMinorUnits } from '@tests/utils/generators'
import { createAccount, runway } from './fixtures'

// Widths are floating-point percentages, so their sum may sit a rounding error away from 100
const PERCENT_DIGITS_THAT_MUST_MATCH = 9

// Enough accounts to sort and split several ways, with room for some to be left out
const MAX_ACCOUNTS = 12

// Balances on both sides of zero and at zero itself, since only a balance above zero gets a bar
const runwayBalances = fc.oneof(fc.constant(0), signedMinorUnits)

// Any mix of accounts the runway could be asked about: picked or not, archived or not, with or without a balance
const runwayAccounts = fc.array(
  fc.record({ balance: runwayBalances, isSelected: fc.boolean(), isArchived: fc.boolean() }),
  { maxLength: MAX_ACCOUNTS },
)

function buildRunwayInputs(rows: { balance: number; isArchived?: boolean }[]) {
  const accounts = rows.map(({ isArchived = false }, index) =>
    createAccount({ id: `account-${index}`, name: `Account ${index}`, is_archived: isArchived }),
  )
  const result: RunwayResult = {
    ...runway,
    account_balances: rows.map(({ balance }, index) => ({ account_id: `account-${index}`, balance })),
  }

  return { accounts, result }
}

function sumPercentages(segments: { pct: number }[]) {
  return segments.reduce((sum, segment) => sum + segment.pct, 0)
}

describe('runway segments', () => {
  it('builds selected account bar segments', () => {
    const accounts = [
      createAccount({ id: 'cash', name: 'Cash' }),
      createAccount({ id: 'savings', name: 'Savings' }),
      createAccount({ id: 'archived', name: 'Archived', is_archived: true }),
      createAccount({ id: 'debt', name: 'Debt', account_kind: 'revolving' }),
    ]

    expect(getRunwaySegments(accounts, ['cash', 'savings', 'archived', 'debt'], runway)).toMatchObject([
      { id: 'cash', amount: 300000, pct: 75, centerPct: 37.5 },
      { id: 'savings', amount: 100000, pct: 25, centerPct: 87.5 },
    ])
  })

  it('fills the bar with three equal accounts', () => {
    const { accounts, result } = buildRunwayInputs([{ balance: 1 }, { balance: 1 }, { balance: 1 }])
    const ids = accounts.map((account) => account.id)

    expect(sumPercentages(getRunwaySegments(accounts, ids, result))).toBeCloseTo(100, PERCENT_DIGITS_THAT_MUST_MATCH)
  })

  it('fills the bar, largest account first, for any accounts that leave a bar to draw', () => {
    fc.assert(
      fc.property(runwayAccounts, (drawn) => {
        const { accounts, result } = buildRunwayInputs(drawn)
        const ids = accounts.filter((_, index) => drawn[index].isSelected).map((account) => account.id)
        const shownBalances = drawn
          .filter(({ balance, isSelected, isArchived }) => isSelected && !isArchived && balance > 0)
          .map(({ balance }) => balance)

        const segments = getRunwaySegments(accounts, ids, result)

        expect(segments.map((segment) => segment.amount)).toStrictEqual(shownBalances.toSorted((a, b) => b - a))
        if (segments.length > 0) {
          expect(sumPercentages(segments)).toBeCloseTo(100, PERCENT_DIGITS_THAT_MUST_MATCH)
        }
      }),
    )
  })
})
