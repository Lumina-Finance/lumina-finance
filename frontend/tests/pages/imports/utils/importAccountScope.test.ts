/**
 * Tests what the import page does with the account its address points at, which decides between
 * running the flow, holding, offering a retry, and refusing the import outright
 */
import { describe, expect, it } from 'vitest'
import type { AccountsOverview } from '@/api/accounts'
import { getImportAccountScopeState } from '@/pages/imports/utils'

/**
 * Creates an account overview, carrying only the fields this rule reads
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

describe('what the import page does with the account in its address', () => {
  it('runs the ordinary flow when the address carries no account', () => {
    expect(getImportAccountScopeState({
      accountId: null,
      account: undefined,
      accountsCurrent: true,
      accountsError: false,
    })).toBe('unscoped')
  })

  // The list being refreshed in the background is not a reason to take a staged import off the
  // screen, so an account the list already holds as open is taken at its word
  it('imports into an open account even while the list is being refreshed', () => {
    expect(getImportAccountScopeState({
      accountId: 'acct-1',
      account: createAccount(),
      accountsCurrent: false,
      accountsError: false,
    })).toBe('ready')
  })

  it('refuses an archived account', () => {
    expect(getImportAccountScopeState({
      accountId: 'acct-1',
      account: createAccount({ is_archived: true }),
      accountsCurrent: true,
      accountsError: false,
    })).toBe('unavailable')
  })

  // The API asks for an open account on every row it writes, so a closed one is refused here rather
  // than at the commit
  it('refuses a closed account', () => {
    expect(getImportAccountScopeState({
      accountId: 'acct-1',
      account: createAccount({ closed_at: '2026-01-31T12:00:00Z' }),
      accountsCurrent: true,
      accountsError: false,
    })).toBe('unavailable')
  })

  it('refuses an account a current list does not hold', () => {
    expect(getImportAccountScopeState({
      accountId: 'acct-missing',
      account: undefined,
      accountsCurrent: true,
      accountsError: false,
    })).toBe('unavailable')
  })

  // The list is kept in local storage for months, so one that predates the account is no reason to
  // refuse it. The page holds until a current list answers
  it('holds when the list in hand does not have the account and a request is still in flight', () => {
    expect(getImportAccountScopeState({
      accountId: 'acct-missing',
      account: undefined,
      accountsCurrent: false,
      accountsError: false,
    })).toBe('loading')
  })

  // Nothing retries on its own, so holding here would be a wait that never ends
  it('offers the retry when the list cannot answer and the last request failed', () => {
    expect(getImportAccountScopeState({
      accountId: 'acct-missing',
      account: undefined,
      accountsCurrent: false,
      accountsError: true,
    })).toBe('failed')
  })

  // A stale list calling an account archived is the same kind of wrong answer as one that has never
  // heard of it, so both wait rather than one waiting and the other refusing
  it('refuses an archived account only once the list is current', () => {
    expect(getImportAccountScopeState({
      accountId: 'acct-1',
      account: createAccount({ is_archived: true }),
      accountsCurrent: false,
      accountsError: false,
    })).toBe('loading')
  })
})
