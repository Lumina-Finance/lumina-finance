/**
 * Tests Firefly account resolution through the production mapping boundary
 */
import { describe, expect, it } from 'vitest'
import type { AccountsOverview } from '@/api/accounts'
import { CREATE_ACCOUNT_VALUE } from '@/pages/imports/constants'
import type { ImportAccountSource } from '@/pages/imports/types'
import { resolveFireflyAccountMappings } from '@/pages/imports/firefly/utils'
import { isAutoFilledAccountSource } from '@/pages/imports/utils'

/** Creates a tracked Firefly account source */
function createSource(name = 'Chequing'): ImportAccountSource {
  return { id: name, label: name, matchText: name, isCounterpartyOnly: false }
}

/** Creates an account overview fixture for name matching */
function createAccount(overrides: Partial<AccountsOverview> = {}): AccountsOverview {
  return {
    id: 'chequing',
    owner_id: null,
    group_id: null,
    account_kind: 'asset',
    account_type: 'checking',
    tax_advantaged_category_id: null,
    name: 'Chequing',
    institution: null,
    currency: 'CAD',
    current_balance: 0,
    base_currency_current_balance: 0,
    current_balance_fx_status: { state: 'complete', missing_pairs: [] },
    credit_limit: null,
    can_write: true,
    is_archived: false,
    ...overrides,
  }
}

describe('resolveFireflyAccountMappings', () => {
  it('leaves an unmatched source unanswered before the first account list is current', () => {
    expect(resolveFireflyAccountMappings({
      sources: [createSource()],
      liveMappings: {},
      selectableAccounts: [],
      accountsCurrent: false,
    })).toEqual({})
  })

  it('waits over a cached empty list before using the matching current account', () => {
    const sources = [createSource()]

    expect(resolveFireflyAccountMappings({
      sources,
      liveMappings: {},
      selectableAccounts: [],
      accountsCurrent: false,
    })).toEqual({})
    expect(resolveFireflyAccountMappings({
      sources,
      liveMappings: {},
      selectableAccounts: [createAccount()],
      accountsCurrent: true,
    })).toEqual({ Chequing: 'chequing' })
  })

  it('does not default to create from an unrelated cached account after a failed refresh', () => {
    expect(resolveFireflyAccountMappings({
      sources: [createSource()],
      liveMappings: {},
      selectableAccounts: [createAccount({ id: 'savings', name: 'Savings' })],
      accountsCurrent: false,
    })).toEqual({})
  })

  it('defaults an unmatched source to create when the account list is current', () => {
    expect(resolveFireflyAccountMappings({
      sources: [createSource()],
      liveMappings: {},
      selectableAccounts: [],
      accountsCurrent: true,
    })).toEqual({ Chequing: CREATE_ACCOUNT_VALUE })
  })

  it('uses a unique name match when the account list is current', () => {
    expect(resolveFireflyAccountMappings({
      sources: [createSource()],
      liveMappings: {},
      selectableAccounts: [createAccount()],
      accountsCurrent: true,
    })).toEqual({ Chequing: 'chequing' })
  })

  it('defaults a nonmatching source to create when the account list is current', () => {
    expect(resolveFireflyAccountMappings({
      sources: [createSource()],
      liveMappings: {},
      selectableAccounts: [createAccount({ id: 'savings', name: 'Savings' })],
      accountsCurrent: true,
    })).toEqual({ Chequing: CREATE_ACCOUNT_VALUE })
  })

  it.each([
    ['Create New Account', CREATE_ACCOUNT_VALUE],
    ['an existing account', 'chequing'],
  ])('preserves an explicit %s answer across account-list readiness', (_label, choice) => {
    const liveMappings = { Chequing: choice }
    const originalMappings = { ...liveMappings }

    for (const accountsCurrent of [false, true]) {
      expect(resolveFireflyAccountMappings({
        sources: [createSource()],
        liveMappings,
        selectableAccounts: [],
        accountsCurrent,
      })).toEqual({ Chequing: choice })
    }
    expect(liveMappings).toEqual(originalMappings)
  })

  it('returns the same answer repeatedly without mutating its inputs', () => {
    const sources = [createSource()]
    const liveMappings: Record<string, string> = {}
    const selectableAccounts = [createAccount()]
    const originalSources = sources.map((source) => ({ ...source }))
    const originalAccounts = selectableAccounts.map((account) => ({ ...account }))

    const options = { sources, liveMappings, selectableAccounts, accountsCurrent: true }
    const first = resolveFireflyAccountMappings(options)
    const second = resolveFireflyAccountMappings(options)

    expect(first).toEqual({ Chequing: 'chequing' })
    expect(second).toEqual(first)
    expect(sources).toEqual(originalSources)
    expect(selectableAccounts).toEqual(originalAccounts)
    expect(liveMappings).toEqual({})
  })

  it('leaves two sources sharing one best account unanswered', () => {
    const sources = [createSource('Everyday Chequing'), createSource('Everyday Chequing Card One')]
    const everyday = createAccount({ id: 'everyday', name: 'Everyday Chequing' })

    expect(resolveFireflyAccountMappings({
      sources,
      liveMappings: {},
      selectableAccounts: [everyday],
      accountsCurrent: true,
    })).toEqual({})
  })

  it('preserves one explicit collision answer without resolving its sibling', () => {
    const sources = [createSource('Everyday Chequing'), createSource('Everyday Chequing Card One')]
    const everyday = createAccount({ id: 'everyday', name: 'Everyday Chequing' })

    expect(resolveFireflyAccountMappings({
      sources,
      liveMappings: { 'Everyday Chequing': 'everyday' },
      selectableAccounts: [everyday],
      accountsCurrent: true,
    })).toEqual({ 'Everyday Chequing': 'everyday' })
  })

  it('preserves two deliberate answers targeting the same account', () => {
    const sources = [createSource('Everyday Chequing'), createSource('Everyday Chequing Card One')]
    const everyday = createAccount({ id: 'everyday', name: 'Everyday Chequing' })
    const liveMappings = {
      'Everyday Chequing': 'everyday',
      'Everyday Chequing Card One': 'everyday',
    }

    expect(resolveFireflyAccountMappings({
      sources,
      liveMappings,
      selectableAccounts: [everyday],
      accountsCurrent: true,
    })).toEqual(liveMappings)
  })

  it('defaults only a noncolliding unmatched source to create', () => {
    const sources = [
      createSource('Everyday Chequing'),
      createSource('Everyday Chequing Card One'),
      createSource('Travel Wallet'),
    ]
    const everyday = createAccount({ id: 'everyday', name: 'Everyday Chequing' })

    expect(resolveFireflyAccountMappings({
      sources,
      liveMappings: {},
      selectableAccounts: [everyday],
      accountsCurrent: true,
    })).toEqual({ 'Travel Wallet': CREATE_ACCOUNT_VALUE })
  })

  it('matches three sources independently when all three exact accounts exist', () => {
    const sources = [
      createSource('Everyday Chequing'),
      createSource('Everyday Chequing Card One'),
      createSource('Everyday Chequing Card Two'),
    ]
    const accounts = [
      createAccount({ id: 'everyday', name: 'Everyday Chequing' }),
      createAccount({ id: 'card-one', name: 'Everyday Chequing Card One' }),
      createAccount({ id: 'card-two', name: 'Everyday Chequing Card Two' }),
    ]

    expect(resolveFireflyAccountMappings({
      sources,
      liveMappings: {},
      selectableAccounts: accounts,
      accountsCurrent: true,
    })).toEqual({
      'Everyday Chequing': 'everyday',
      'Everyday Chequing Card One': 'card-one',
      'Everyday Chequing Card Two': 'card-two',
    })
  })
})

describe('Firefly account auto-fill classification', () => {
  it('highlights only an inferred existing-account answer', () => {
    expect(isAutoFilledAccountSource('', '', false)).toBe(false)
    expect(isAutoFilledAccountSource('', CREATE_ACCOUNT_VALUE, false)).toBe(false)
    expect(isAutoFilledAccountSource('', 'chequing', false)).toBe(true)
    expect(isAutoFilledAccountSource('chequing', 'chequing', false)).toBe(false)
  })
})
