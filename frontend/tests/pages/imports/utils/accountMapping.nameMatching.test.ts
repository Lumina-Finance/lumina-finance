/**
 * Tests which existing account the import guesses for a source by name, now that the rule scoring
 * one name contained inside the other is what settles most of them, and what the guesser leaves
 * alone rather than choosing between
 */
import { describe, expect, it } from 'vitest'
import type { AccountsOverview } from '@/api/accounts'
import type { ImportAccountSource } from '@/pages/imports/types'
import { OUTSIDE_ACCOUNT_VALUE } from '@/utils/transfers'
import { inferAccountMappings } from '@/pages/imports/utils'

/**
 * Creates a mapping source, defaulting to one rows are written to
 */
function createSource(id: string, overrides: Partial<ImportAccountSource> = {}): ImportAccountSource {
  return { id, label: id, matchText: id, isCounterpartyOnly: false, ...overrides }
}

/**
 * Creates an account overview, carrying only the fields the name match reads
 */
function createAccount(overrides: Partial<AccountsOverview> = {}): AccountsOverview {
  return {
    id: 'acct-1',
    owner_id: null,
    group_id: null,
    account_kind: 'asset',
    account_type: 'checking',
    tax_advantaged_category_id: null,
    name: 'Everyday',
    institution: null,
    currency: 'CAD',
    current_balance: 0,
    base_currency_current_balance: 0,
    current_balance_fx_status: { state: 'complete', missing_pairs: [] },
    credit_limit: null,
    can_write: true,
    is_archived: false,
    closed_at: null,
    ...overrides,
  }
}

describe('guessing which account a source belongs to by name', () => {
  it('refuses to choose between two accounts sharing a name', () => {
    const source = createSource('Savings')
    const accounts = [
      createAccount({ id: 'acct-1', name: 'Savings' }),
      createAccount({ id: 'acct-2', name: 'Savings' }),
    ]

    expect(inferAccountMappings([source], {}, { rowAccounts: accounts, counterpartyAccounts: accounts })).toEqual({})
  })

  // Without the chequing-to-checking rewrite the two share only one word out of two, which fails
  // both the shared-word rule and the substring rule, so this genuinely fails if the rewrite goes
  it('matches an account spelling chequing the British way against one spelling it checking', () => {
    const source = createSource('Everyday Chequing')
    const accounts = [createAccount({ id: 'acct-1', name: 'Everyday Checking' })]

    expect(inferAccountMappings([source], {}, { rowAccounts: accounts, counterpartyAccounts: accounts }))
      .toEqual({ 'Everyday Chequing': 'acct-1' })
  })

  it('leaves a source and an account unmatched where both clean away to nothing', () => {
    const source = createSource('Transactions')
    const accounts = [createAccount({ id: 'acct-1', name: 'Statement' })]

    expect(inferAccountMappings([source], {}, { rowAccounts: accounts, counterpartyAccounts: accounts })).toEqual({})
  })

  it('fills in a stored blank answer but leaves a stored outside answer alone', () => {
    const sources = [createSource('Empty'), createSource('Outside', { isCounterpartyOnly: true })]
    const accounts = [createAccount({ id: 'acct-1', name: 'Empty' })]

    const result = inferAccountMappings(
      sources,
      { Empty: '', Outside: OUTSIDE_ACCOUNT_VALUE },
      { rowAccounts: accounts, counterpartyAccounts: accounts },
    )

    expect(result.Empty).toBe('acct-1')
    expect(result.Outside).toBe(OUTSIDE_ACCOUNT_VALUE)
  })
})
