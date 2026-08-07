/**
 * Tests the narrowing that hands an account to the transaction list, which is what the list reads
 * to decide whether the account can take new transactions and whether an import may be written to it
 */
import { describe, expect, it } from 'vitest'
import type { AccountsOverview } from '@/api/accounts'
import { toTransactionListAccount } from '@/pages/transactions/types/transactionList'

/**
 * Creates an account overview, carrying only the fields this narrowing reads
 */
function createAccount(overrides: Partial<AccountsOverview> = {}): AccountsOverview {
  return {
    id: 'acct-1',
    owner_id: null,
    group_id: null,
    account_kind: 'asset',
    account_type: 'checking',
    tax_advantaged_category_id: null,
    name: 'Everyday Chequing',
    institution: null,
    currency: 'CAD',
    current_balance: 0,
    base_currency_current_balance: 0,
    current_balance_fx_status: { state: 'complete', missing_pairs: [] },
    credit_limit: null,
    is_archived: false,
    closed_at: null,
    ...overrides,
  }
}

describe('the account the transaction list is handed', () => {
  it('carries the fields the list renders and answers with', () => {
    expect(toTransactionListAccount(createAccount())).toEqual({
      id: 'acct-1',
      name: 'Everyday Chequing',
      currency: 'CAD',
      institution: null,
      is_archived: false,
      closed_at: null,
    })
  })

  // Dropped here, the toolbar cannot tell a closed account from an open one, and offers an import
  // the API would refuse
  it('carries the closing date through', () => {
    const account = createAccount({ closed_at: '2026-03-01T14:00:00Z' })

    expect(toTransactionListAccount(account).closed_at).toBe('2026-03-01T14:00:00Z')
  })

  it('carries the archived state through', () => {
    expect(toTransactionListAccount(createAccount({ is_archived: true })).is_archived).toBe(true)
  })
})
