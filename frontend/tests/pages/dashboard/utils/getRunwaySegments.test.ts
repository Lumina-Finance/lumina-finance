/**
 * Tests the runway bar segments, so the widths and positions of the account bars cannot drift from the
 * balances behind them
 *
 * Two of the four accounts get no bar. The archived one is dropped by the helper's own check, and the
 * revolving one is dropped for having no balance recorded against it rather than for its kind, since
 * liabilities are already filtered out before this helper sees them
 */
import { describe, expect, it } from 'vitest'
import { getRunwaySegments } from '@/pages/dashboard/utils/getRunwaySegments'
import { createAccount, runway } from './fixtures'

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
})
