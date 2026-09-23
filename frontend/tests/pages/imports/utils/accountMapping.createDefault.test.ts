/**
 * Tests the rules behind resting an unmatched account source on creating a new account, and the
 * currency such a row starts out holding, including the two things that quietly stop working once
 * every row source has an answer: the archived-account notice and the auto-fill highlight
 */
import { describe, expect, it } from 'vitest'
import { CREATE_ACCOUNT_VALUE } from '@/pages/imports/constants'
import type { AccountsOverview } from '@/api/accounts'
import type { ImportAccountSource, ImportFileDraft } from '@/pages/imports/types'
import { OUTSIDE_ACCOUNT_VALUE } from '@/utils/transfers'
import {
  applyCreateAccountFallback,
  getArchivedAccountMatches,
  getStatedCurrencyByAccountSource,
  isAutoFilledAccountSource,
  resolveImportAccountCreateCurrencies,
  resolveImportAccountMappings,
} from '@/pages/imports/utils'

const SUPPORTED_CURRENCIES = new Set(['CAD', 'USD', 'EUR'])

/**
 * Creates a staged file holding the given rows, with the account and currency columns this suite maps
 */
function createFile(overrides: Partial<ImportFileDraft> = {}): ImportFileDraft {
  return {
    id: 'file-1',
    name: 'Chequing.csv',
    size: 1024,
    headers: ['Account', 'Currency', 'Amount'],
    hasHeaderRow: true,
    rows: [],
    error: null,
    ...overrides,
  }
}

/**
 * Creates a mapping source, defaulting to one rows are written to
 */
function createSource(id: string, overrides: Partial<ImportAccountSource> = {}): ImportAccountSource {
  return { id, label: id, matchText: id, isCounterpartyOnly: false, ...overrides }
}

/**
 * Creates an account overview, carrying only the fields these rules read
 */
function createAccount(overrides: Partial<AccountsOverview> = {}): AccountsOverview {
  return {
    id: 'checking',
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

describe('the currency an account source states', () => {
  it('takes the code every row of a source agrees on, upper-cased', () => {
    const file = createFile({
      rows: [
        { Account: 'Travel Card', Currency: 'usd', Amount: '-10.00' },
        { Account: 'Travel Card', Currency: 'USD', Amount: '-20.00' },
        { Account: 'Everyday', Currency: 'CAD', Amount: '-30.00' },
      ],
    })

    expect(getStatedCurrencyByAccountSource([file], 'Account', 'Currency', SUPPORTED_CURRENCIES)).toEqual({
      'Travel Card': 'USD',
      Everyday: 'CAD',
    })
  })

  it('leaves out a source whose rows state two different currencies', () => {
    const file = createFile({
      rows: [
        { Account: 'Travel Card', Currency: 'USD', Amount: '-10.00' },
        { Account: 'Travel Card', Currency: 'EUR', Amount: '-20.00' },
      ],
    })

    expect(getStatedCurrencyByAccountSource([file], 'Account', 'Currency', SUPPORTED_CURRENCIES)).toEqual({})
  })

  // The box would otherwise hold a value its own dropdown does not offer, so the row would read as
  // answered while the commit refused it
  it('leaves out a source stating a code the app does not support', () => {
    const file = createFile({
      rows: [{ Account: 'Travel Card', Currency: 'XBT', Amount: '-10.00' }],
    })

    expect(getStatedCurrencyByAccountSource([file], 'Account', 'Currency', SUPPORTED_CURRENCIES)).toEqual({})
  })

  it('ignores the rows of a source that leave the currency cell empty', () => {
    const file = createFile({
      rows: [
        { Account: 'Travel Card', Currency: '', Amount: '-10.00' },
        { Account: 'Travel Card', Currency: 'USD', Amount: '-20.00' },
      ],
    })

    expect(getStatedCurrencyByAccountSource([file], 'Account', 'Currency', SUPPORTED_CURRENCIES)).toEqual({
      'Travel Card': 'USD',
    })
  })

  it('states nothing when no currency column is mapped', () => {
    const file = createFile({
      rows: [{ Account: 'Travel Card', Currency: 'USD', Amount: '-10.00' }],
    })

    expect(getStatedCurrencyByAccountSource([file], 'Account', '', SUPPORTED_CURRENCIES)).toEqual({})
  })

  // With no account column the file itself is the source, and `buildImportAccountMappingSources`
  // keys that source by the file id rather than its label, so this has to agree or the prefill
  // lands under a key nothing reads
  it('keys the file itself by its id when no account column is mapped', () => {
    const file = createFile({
      rows: [
        { Account: 'ignored', Currency: 'EUR', Amount: '-10.00' },
        { Account: 'ignored', Currency: 'EUR', Amount: '-20.00' },
      ],
    })

    expect(getStatedCurrencyByAccountSource([file], '', 'Currency', SUPPORTED_CURRENCIES)).toEqual({
      'file-1': 'EUR',
    })
  })

  it('skips rows whose account cell is empty, which are no source at all', () => {
    const file = createFile({
      rows: [
        { Account: '  ', Currency: 'USD', Amount: '-10.00' },
        { Account: ' Travel Card ', Currency: 'USD', Amount: '-20.00' },
      ],
    })

    expect(getStatedCurrencyByAccountSource([file], 'Account', 'Currency', SUPPORTED_CURRENCIES)).toEqual({
      'Travel Card': 'USD',
    })
  })
})

describe('the currency a row creating an account holds', () => {
  const stated = { 'Travel Card': 'USD' }

  it('prefers what the user picked over what the file states', () => {
    const mappings = { 'Travel Card': CREATE_ACCOUNT_VALUE }

    expect(resolveImportAccountCreateCurrencies({ 'Travel Card': 'CAD' }, mappings, stated)).toEqual({
      'Travel Card': 'CAD',
    })
  })

  it('falls back to what the file states', () => {
    const mappings = { 'Travel Card': CREATE_ACCOUNT_VALUE }

    expect(resolveImportAccountCreateCurrencies({}, mappings, stated)).toEqual({ 'Travel Card': 'USD' })
  })

  it('leaves the box empty when neither says anything', () => {
    const mappings = { Everyday: CREATE_ACCOUNT_VALUE }

    expect(resolveImportAccountCreateCurrencies({}, mappings, stated)).toEqual({ Everyday: '' })
  })

  // Nothing has to clear the prefill when a row stops creating an account, because this simply
  // stops covering that source
  it('says nothing about a source not creating an account', () => {
    const mappings = { 'Travel Card': 'checking', Outside: OUTSIDE_ACCOUNT_VALUE }

    expect(resolveImportAccountCreateCurrencies({ 'Travel Card': 'CAD' }, mappings, stated)).toEqual({})
  })
})

describe('resting an unanswered row source on creating an account', () => {
  it('fills in every row source with no answer', () => {
    const sources = [createSource('Travel Card'), createSource('Everyday')]

    expect(applyCreateAccountFallback(sources, { Everyday: '' })).toEqual({
      'Travel Card': CREATE_ACCOUNT_VALUE,
      Everyday: CREATE_ACCOUNT_VALUE,
    })
  })

  it('leaves an answered row source alone', () => {
    const sources = [createSource('Travel Card')]

    expect(applyCreateAccountFallback(sources, { 'Travel Card': 'checking' })).toEqual({
      'Travel Card': 'checking',
    })
  })

  // No row is written to a counterparty source, so creating an account for it would invent one
  // nothing is ever filed against
  it('leaves a counterparty-only source alone whether it is answered or not', () => {
    const sources = [
      createSource('Mum', { isCounterpartyOnly: true }),
      createSource('Brokerage', { isCounterpartyOnly: true }),
    ]

    expect(applyCreateAccountFallback(sources, { Mum: OUTSIDE_ACCOUNT_VALUE })).toEqual({
      Mum: OUTSIDE_ACCOUNT_VALUE,
    })
  })

  it('does not touch a source it was not given', () => {
    expect(applyCreateAccountFallback([], { Everyday: '' })).toEqual({ Everyday: '' })
  })
})

describe('generic account mapping composition', () => {
  it('defaults an unmatched row source to create when the account list is current', () => {
    const result = resolveImportAccountMappings({
      sources: [createSource('Everyday')],
      liveMappings: {},
      clearedSourceIds: new Set(),
      fixedAccountId: null,
      canInfer: true,
      accountsCurrent: true,
      rowAccounts: [],
      counterpartyAccounts: [],
    })

    expect(result).toEqual({
      matchedMappings: {},
      resolvedMappings: { Everyday: CREATE_ACCOUNT_VALUE },
    })
  })

  it('defaults an unanswered counterparty source to outside', () => {
    const result = resolveImportAccountMappings({
      sources: [createSource('Mum', { isCounterpartyOnly: true })],
      liveMappings: {},
      clearedSourceIds: new Set(),
      fixedAccountId: null,
      canInfer: true,
      accountsCurrent: true,
      rowAccounts: [],
      counterpartyAccounts: [],
    })

    expect(result).toEqual({
      matchedMappings: { Mum: OUTSIDE_ACCOUNT_VALUE },
      resolvedMappings: { Mum: OUTSIDE_ACCOUNT_VALUE },
    })
  })

  it('gives a fixed account precedence over name matching and defaults', () => {
    const source = createSource('file-1', { label: 'Everyday', matchText: 'Everyday.csv' })
    const everyday = createAccount({ id: 'everyday', name: 'Everyday' })

    const result = resolveImportAccountMappings({
      sources: [source],
      liveMappings: {},
      clearedSourceIds: new Set(),
      fixedAccountId: 'fixed-account',
      canInfer: true,
      accountsCurrent: true,
      rowAccounts: [everyday],
      counterpartyAccounts: [everyday],
    })

    expect(result).toEqual({
      matchedMappings: { 'file-1': 'fixed-account' },
      resolvedMappings: { 'file-1': 'fixed-account' },
    })
  })

  it('keeps a cleared row out of inference before applying the create fallback', () => {
    const source = createSource('Chequing')
    const chequing = createAccount({ id: 'chequing', name: 'Chequing' })

    const result = resolveImportAccountMappings({
      sources: [source],
      liveMappings: {},
      clearedSourceIds: new Set(['Chequing']),
      fixedAccountId: null,
      canInfer: true,
      accountsCurrent: true,
      rowAccounts: [chequing],
      counterpartyAccounts: [chequing],
    })

    expect(result).toEqual({
      matchedMappings: {},
      resolvedMappings: { Chequing: CREATE_ACCOUNT_VALUE },
    })
  })

  it('keeps the pre-default mapping available to the archived-account notice', () => {
    const source = createSource('Old Savings')
    const archived = createAccount({ id: 'old-savings', name: 'Old Savings', is_archived: true })

    const result = resolveImportAccountMappings({
      sources: [source],
      liveMappings: {},
      clearedSourceIds: new Set(),
      fixedAccountId: null,
      canInfer: true,
      accountsCurrent: true,
      rowAccounts: [],
      counterpartyAccounts: [archived],
    })

    expect(result.matchedMappings).toEqual({})
    expect(result.resolvedMappings).toEqual({ 'Old Savings': CREATE_ACCOUNT_VALUE })
    expect(getArchivedAccountMatches([source], result.matchedMappings, [archived]))
      .toEqual([{ id: 'old-savings', name: 'Old Savings' }])
  })

  it('keeps colliding row and counterparty sources out of both automatic defaults', () => {
    const everyday = createAccount({ id: 'everyday', name: 'Everyday Chequing' })
    const sources = [
      createSource('everyday-source', { label: 'Everyday Chequing', matchText: 'Everyday Chequing' }),
      createSource('card-source', {
        label: 'Everyday Chequing Card One',
        matchText: 'Everyday Chequing Card One',
      }),
      createSource('everyday-counterparty', {
        label: 'Everyday Chequing',
        matchText: 'Everyday Chequing',
        isCounterpartyOnly: true,
      }),
      createSource('card-counterparty', {
        label: 'Everyday Chequing Card Two',
        matchText: 'Everyday Chequing Card Two',
        isCounterpartyOnly: true,
      }),
      createSource('unmatched-row', { label: 'Travel Wallet', matchText: 'Travel Wallet' }),
      createSource('unmatched-counterparty', {
        label: 'External Vendor',
        matchText: 'External Vendor',
        isCounterpartyOnly: true,
      }),
    ]

    const result = resolveImportAccountMappings({
      sources,
      liveMappings: {},
      clearedSourceIds: new Set(),
      fixedAccountId: null,
      canInfer: true,
      accountsCurrent: true,
      rowAccounts: [everyday],
      counterpartyAccounts: [everyday],
    })

    expect(result.matchedMappings).toEqual({ 'unmatched-counterparty': OUTSIDE_ACCOUNT_VALUE })
    expect(result.resolvedMappings).toEqual({
      'unmatched-row': CREATE_ACCOUNT_VALUE,
      'unmatched-counterparty': OUTSIDE_ACCOUNT_VALUE,
    })
  })

  it('keeps a cleared collision member in discovery while excluding it from assignment', () => {
    const everyday = createAccount({ id: 'everyday', name: 'Everyday Chequing' })
    const sources = [
      createSource('everyday-source', { label: 'Everyday Chequing', matchText: 'Everyday Chequing' }),
      createSource('card-source', {
        label: 'Everyday Chequing Card One',
        matchText: 'Everyday Chequing Card One',
      }),
    ]

    expect(resolveImportAccountMappings({
      sources,
      liveMappings: {},
      clearedSourceIds: new Set(['everyday-source']),
      fixedAccountId: null,
      canInfer: true,
      accountsCurrent: true,
      rowAccounts: [everyday],
      counterpartyAccounts: [everyday],
    })).toEqual({ matchedMappings: {}, resolvedMappings: {} })
  })

  it('preserves a fixed row answer while leaving its colliding counterparty unanswered', () => {
    const everyday = createAccount({ id: 'everyday', name: 'Everyday Chequing' })
    const sources = [
      createSource('row-source', { label: 'Everyday Chequing', matchText: 'Everyday Chequing' }),
      createSource('counterparty-source', {
        label: 'Everyday Chequing Card One',
        matchText: 'Everyday Chequing Card One',
        isCounterpartyOnly: true,
      }),
    ]

    expect(resolveImportAccountMappings({
      sources,
      liveMappings: {},
      clearedSourceIds: new Set(),
      fixedAccountId: 'fixed-account',
      canInfer: true,
      accountsCurrent: true,
      rowAccounts: [everyday],
      counterpartyAccounts: [everyday],
    })).toEqual({
      matchedMappings: { 'row-source': 'fixed-account' },
      resolvedMappings: { 'row-source': 'fixed-account' },
    })
  })

  it('preserves the archived exact-name notice after suppressing an active-account collision', () => {
    const everyday = createAccount({ id: 'everyday', name: 'Everyday Chequing' })
    const archivedCard = createAccount({
      id: 'archived-card',
      name: 'Everyday Chequing Card One',
      is_archived: true,
    })
    const sources = [
      createSource('everyday-source', { label: 'Everyday Chequing', matchText: 'Everyday Chequing' }),
      createSource('card-source', {
        label: 'Everyday Chequing Card One',
        matchText: 'Everyday Chequing Card One',
      }),
    ]

    const result = resolveImportAccountMappings({
      sources,
      liveMappings: {},
      clearedSourceIds: new Set(),
      fixedAccountId: null,
      canInfer: true,
      accountsCurrent: true,
      rowAccounts: [everyday],
      counterpartyAccounts: [everyday, archivedCard],
    })

    expect(result).toEqual({ matchedMappings: {}, resolvedMappings: {} })
    expect(getArchivedAccountMatches(sources, result.matchedMappings, [everyday, archivedCard]))
      .toEqual([{ id: 'archived-card', name: 'Everyday Chequing Card One' }])
  })
})

describe('what the archived-account notice is read from', () => {
  const archivedSavings = createAccount({ id: 'savings', name: 'Old Savings', is_archived: true })
  const chequing = createAccount()
  const accounts = [chequing, archivedSavings]
  const source = createSource('Old Savings')

  // The notice only speaks about a source with no answer, and the fallback answers every one of
  // them, so reading the finished map would drop the notice and let the import quietly create a
  // second account carrying the archived one's name
  it('survives on the map before the fallback and vanishes on the map after it', () => {
    const matched = {}
    const resolved = applyCreateAccountFallback([source], matched)

    expect(getArchivedAccountMatches([source], matched, accounts)).toEqual([{ id: 'savings', name: 'Old Savings' }])
    expect(getArchivedAccountMatches([source], resolved, accounts)).toEqual([])
  })
})

describe('which answers carry the auto-fill highlight', () => {
  it('highlights an account matched from the file', () => {
    expect(isAutoFilledAccountSource('', 'checking', false)).toBe(true)
  })

  it('leaves an answer the user gave plain', () => {
    expect(isAutoFilledAccountSource('checking', 'checking', false)).toBe(false)
  })

  it('leaves an unanswered row plain', () => {
    expect(isAutoFilledAccountSource('', '', false)).toBe(false)
  })

  // Both defaults are what the step falls back to having recognised nothing, so neither is a match
  it('leaves both defaults plain', () => {
    expect(isAutoFilledAccountSource('', CREATE_ACCOUNT_VALUE, false)).toBe(false)
    expect(isAutoFilledAccountSource('', OUTSIDE_ACCOUNT_VALUE, true)).toBe(false)
  })
})
