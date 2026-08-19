/**
 * Tests import workflow option helpers so dropdown ordering, file-name account fallbacks, and imported value lists stay stable after hook refactors
 */
import { describe, expect, it } from 'vitest'
import type { AccountsOverview } from '@/api/accounts'
import type { Category } from '@/api/categories'
import type { Currency } from '@/api/currency'
import type { Institution } from '@/api/institutions'
import {
  AMOUNT_ARRANGEMENT_CLASH_ERROR,
  COLUMN_TARGETS,
  CREATE_ACCOUNT_VALUE,
  CREATE_CATEGORY_VALUE,
  CURRENCIES_FAILED_UPLOAD_BLOCK,
  CURRENCIES_LOADING_UPLOAD_BLOCK,
  DIRECTION_ARRANGEMENT_CLASH_ERROR,
  EMPTY_COLUMN_MAP,
  getRowSignDisagreesWithCategoryReason,
  MISSING_AMOUNT_COLUMN_LABEL,
  UNSET_BATCH_INSTITUTION,
} from '@/pages/imports/constants'
import type { ImportFileDraft } from '@/pages/imports/types'
import {
  buildColumnTargetOptions,
  buildImportAccountMappingSources,
  buildImportAccountOptions,
  buildImportCategoryMatchOptions,
  buildImportCurrencyOptions,
  buildImportInstitutionOptions,
  getAmountArrangementClashError,
  getArchivedAccountMatches,
  getImportedCategories,
  getImportedMerchants,
  getImportedTags,
  getImportHeaders,
  getImportUploadBlockReason,
  getMissingRequiredColumnLabels,
  getSupportedCurrencyCodes,
  inferAccountMappings,
} from '@/pages/imports/utils'

/**
 * Creates an account overview fixture for option grouping
 */
function createAccount(overrides: Partial<AccountsOverview> = {}): AccountsOverview {
  return {
    id: overrides.id ?? 'checking',
    owner_id: null,
    group_id: null,
    account_kind: overrides.account_kind ?? 'asset',
    account_type: 'checking',
    tax_advantaged_category_id: null,
    name: overrides.name ?? 'Checking',
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

/**
 * Creates a category fixture for category match options
 */
function createCategory(overrides: Partial<Category> = {}): Category {
  return {
    id: overrides.id ?? 'category',
    group_id: null,
    owner_id: null,
    name: overrides.name ?? 'Category',
    kind: overrides.kind ?? 'expense',
    icon: overrides.icon ?? null,
    is_system: false,
    created_at: '2026-01-01T00:00:00Z',
    ...overrides,
  }
}

/**
 * Creates an import file draft with representative rows
 */
function createFile(overrides: Partial<ImportFileDraft> = {}): ImportFileDraft {
  return {
    id: overrides.id ?? 'file-1',
    name: overrides.name ?? 'Checking.csv',
    size: 1024,
    headers: overrides.headers ?? ['Account', 'Category', 'Merchant', 'Tags'],
    hasHeaderRow: true,
    rows: overrides.rows ?? [],
    error: null,
    ...overrides,
  }
}

describe('import workflow option helpers', () => {
  it('builds dropdown options with action and none choices pinned first', () => {
    const currencies: Currency[] = [
      { id: 'CAD', name: 'Canadian Dollar', symbol: '$', minor_unit_exponent: 2 },
    ]
    const institutions: Institution[] = [
      { id: 'bank', status: 'active', name: 'Bank', country_code: 'CA', website: '', logo_url: null },
    ]

    expect(buildImportAccountOptions([
      createAccount({ id: 'visa', name: 'Visa', account_kind: 'revolving' }),
    ])).toEqual([
      { value: CREATE_ACCOUNT_VALUE, label: 'Create New Account', group: 'Import Action' },
      { value: 'visa', label: 'Visa', group: 'Revolving Credit' },
    ])
    expect(buildImportCurrencyOptions(currencies)).toEqual([{ value: 'CAD', label: 'CAD' }])
    expect(buildImportInstitutionOptions(institutions)).toEqual([
      { value: '', label: 'None' },
      { value: 'bank', label: 'Bank' },
    ])
  })

  // The batch bar shows its placeholder by holding a value no option carries, so the moment one
  // does, the resting control reads as an answer the user never gave
  it('offers no institution option matching the unset value the batch bar holds', () => {
    const options = buildImportInstitutionOptions([{ id: 'bank', name: 'Bank' } as Institution])

    expect(options.some((option) => option.value === UNSET_BATCH_INSTITUTION)).toBe(false)
  })

  it('sorts category match options by kind and name after the create action', () => {
    expect(buildImportCategoryMatchOptions([
      createCategory({ id: 'transfer', name: 'Between accounts', kind: 'transfer' }),
      createCategory({ id: 'salary', name: 'Salary', kind: 'income', icon: '💵' }),
      createCategory({ id: 'food', name: 'Food', kind: 'expense' }),
      createCategory({ id: 'rent', name: 'Rent', kind: 'expense' }),
    ])).toMatchObject([
      { value: CREATE_CATEGORY_VALUE, label: 'Create new category', group: 'Import action' },
      { value: 'food', label: 'Food', group: 'Expense' },
      { value: 'rent', label: 'Rent', group: 'Expense' },
      { value: 'salary', label: 'Salary', group: 'Income' },
      { value: 'transfer', label: 'Between accounts', group: 'Transfer' },
    ])
  })

  it('derives headers, required-column gaps, account sources, and imported values from files', () => {
    const files = [
      createFile({
        id: 'checking-file',
        name: 'Chequing Activity.csv',
        headers: ['Account', 'Category', 'Tags'],
        rows: [
          { Account: 'Main', Category: 'Groceries', Merchant: 'Market', Tags: 'food, essentials' },
          { Account: 'Main', Category: 'Rent', Merchant: 'Landlord', Tags: 'housing' },
        ],
      }),
      createFile({
        id: 'visa-file',
        name: 'Visa.csv',
        headers: ['Account', 'Category', 'Merchant'],
        rows: [
          { Account: 'Visa', Category: 'Groceries', Merchant: 'Market', Tags: '' },
        ],
      }),
    ]

    expect(getImportHeaders(files)).toEqual(['Account', 'Category', 'Tags', 'Merchant'])
    expect(getMissingRequiredColumnLabels({ ...EMPTY_COLUMN_MAP, dt: 'Date' })).toContain(MISSING_AMOUNT_COLUMN_LABEL)
    expect(buildImportAccountMappingSources(files, '', '')).toEqual([
      { id: 'checking-file', label: 'Chequing Activity', matchText: 'Chequing Activity.csv', isCounterpartyOnly: false },
      { id: 'visa-file', label: 'Visa', matchText: 'Visa.csv', isCounterpartyOnly: false },
    ])
    expect(buildImportAccountMappingSources(files, 'Account', '')).toEqual([
      { id: 'Main', label: 'Main', matchText: 'Main', isCounterpartyOnly: false },
      { id: 'Visa', label: 'Visa', matchText: 'Visa', isCounterpartyOnly: false },
    ])
    expect(getImportedCategories(files, 'Category')).toEqual(['Groceries', 'Rent'])
    expect(getImportedMerchants(files, 'Merchant')).toEqual(['Landlord', 'Market'])
    expect(getImportedTags(files, 'Tags')).toEqual(['essentials', 'food', 'housing'])
  })

  it('carries every field explanation into the column target options', () => {
    const options = buildColumnTargetOptions()

    // Ignoring a column explains itself, and it is the only entry outside the three groups
    expect(options[0]).toEqual({ value: '', label: 'Do not import' })
    expect(options.slice(1).every((option) => Boolean(option.description))).toBe(true)
    expect(options.find((option) => option.value === 'merchant_id')?.description).toBe(
      COLUMN_TARGETS.find((target) => target.id === 'merchant_id')?.hint,
    )

    // The groups run in a fixed order rather than following declaration order, and each one is
    // headed once, since the dropdown opens a heading every time the group changes going down
    const groups = options.slice(1).map((option) => option.group)
    const headings = groups.filter((group, index) => group !== groups[index - 1])

    expect(headings).toEqual([
      'Required fields',
      'Required, at least one of these',
      'Optional, beside a single Amount column',
      'Optional fields',
    ])
  })

  // An import started from an account has its answer already, so no column may contradict it
  it('leaves the account field out of the column targets when the account is fixed', () => {
    const options = buildColumnTargetOptions({ omitAccountColumn: true })
    const values = options.map((option) => option.value)

    expect(values).not.toContain('account_id')
    expect(values).toEqual(expect.arrayContaining([
      '',
      'dt',
      'amount',
      'category_id',
      'counterparty_account_id',
    ]))
  })


  it('marks an archived account wherever it is offered', () => {
    const options = buildImportAccountOptions([
      createAccount({ id: 'savings', name: 'Old Savings', is_archived: true }),
      createAccount({ id: 'checking', name: 'Chequing' }),
    ])

    expect(options.find((option) => option.value === 'savings')?.badge).toBe('Archived')
    expect(options.find((option) => option.value === 'checking')?.badge).toBeUndefined()
  })

  it('gathers accounts by kind, so no heading is reached twice', () => {
    const options = buildImportAccountOptions([
      createAccount({ id: 'visa', name: 'Visa', account_kind: 'revolving' }),
      createAccount({ id: 'savings', name: 'Savings' }),
      createAccount({ id: 'mortgage', name: 'Mortgage', account_kind: 'amortizing' }),
      createAccount({ id: 'chequing', name: 'Chequing' }),
    ])

    // Creation order interleaves the kinds, and the dropdown heads a group every time the group
    // changes going down the list
    expect(options.map((option) => option.group)).toEqual([
      'Import Action',
      'Assets',
      'Assets',
      'Revolving Credit',
      'Amortizing Debt',
    ])
    expect(options.map((option) => option.label)).toEqual([
      'Create New Account',
      'Chequing',
      'Savings',
      'Visa',
      'Mortgage',
    ])
  })
})

describe('archived accounts in account mapping', () => {
  const archivedSavings = createAccount({ id: 'savings', name: 'Old Savings', is_archived: true })
  const chequing = createAccount({ id: 'checking', name: 'Chequing' })
  const rowSource = { id: 'Old Savings', label: 'Old Savings', matchText: 'Old Savings', isCounterpartyOnly: false }
  const counterpartySource = { ...rowSource, isCounterpartyOnly: true }

  it('matches a counterparty source to an archived account and leaves a row source unmapped', () => {
    const lists = { rowAccounts: [chequing], counterpartyAccounts: [chequing, archivedSavings] }

    expect(inferAccountMappings([counterpartySource], {}, lists)).toEqual({ 'Old Savings': 'savings' })
    expect(inferAccountMappings([rowSource], {}, lists)).toEqual({})
  })

  it('reports the archived account a row source was left unmapped by', () => {
    const accounts = [chequing, archivedSavings]

    // The id comes back with the name, since the notice links each one to the account's own page
    expect(getArchivedAccountMatches([rowSource], {}, accounts)).toEqual([{ id: 'savings', name: 'Old Savings' }])

    // Nothing to say once the source is answered, and nothing to say about a counterparty source,
    // which is offered the archived account in the first place
    expect(getArchivedAccountMatches([rowSource], { 'Old Savings': 'checking' }, accounts)).toEqual([])
    expect(getArchivedAccountMatches([counterpartySource], {}, accounts)).toEqual([])
    expect(getArchivedAccountMatches([rowSource], {}, [chequing])).toEqual([])
  })

  it('lists an archived account once however many sources point at it', () => {
    const secondSource = { ...rowSource, id: 'Old Savings Account', matchText: 'Old Savings Account' }

    expect(getArchivedAccountMatches([rowSource, secondSource], {}, [chequing, archivedSavings]))
      .toEqual([{ id: 'savings', name: 'Old Savings' }])
  })
})

describe('blocking the upload until the currency list is in hand', () => {
  const currencies: Currency[] = [
    { id: 'CAD', name: 'Canadian Dollar', symbol: '$', minor_unit_exponent: 2 },
  ]

  it('lets a file be uploaded once the list has arrived', () => {
    expect(getImportUploadBlockReason(currencies, false)).toBeNull()
  })

  it('blocks on an empty list, whether it failed or has simply not arrived', () => {
    // A request the browser has not started, which is what an offline page has, reports neither
    // loading nor failed, so the list itself is what decides rather than the request's state
    expect(getImportUploadBlockReason([], false)).toEqual({ message: CURRENCIES_LOADING_UPLOAD_BLOCK, isFailure: false })
    expect(getImportUploadBlockReason([], true)).toEqual({ message: CURRENCIES_FAILED_UPLOAD_BLOCK, isFailure: true })
  })

  it('marks only the failed case as one the user has to act on', () => {
    // Waiting a moment on an ordinary page load should not be dressed as an error, so only the
    // failure gets the error treatment and the instruction to reload
    expect(getImportUploadBlockReason([], true)?.isFailure).toBe(true)
    expect(getImportUploadBlockReason([], true)?.message).toContain('Reload the page')
    expect(getImportUploadBlockReason([], false)?.isFailure).toBe(false)
    expect(getImportUploadBlockReason([], false)?.message).not.toContain('Reload the page')
  })
})

describe('collecting the supported currency codes', () => {
  it('holds every code the list carries and nothing else', () => {
    const codes = getSupportedCurrencyCodes([
      { id: 'CAD', name: 'Canadian Dollar', symbol: '$', minor_unit_exponent: 2 },
      { id: 'JPY', name: 'Japanese Yen', symbol: '\u00a5', minor_unit_exponent: 0 },
    ])

    expect(codes.has('CAD')).toBe(true)
    expect(codes.has('JPY')).toBe(true)
    expect(codes.has('ZZZ')).toBe(false)
    expect(codes.size).toBe(2)
  })
})

describe('the three ways a file can carry its amount', () => {
  const MAPPED_ELSEWHERE = { ...EMPTY_COLUMN_MAP, dt: 'Date', category_id: 'Category' }

  it('asks for an amount where no arrangement is mapped', () => {
    expect(getMissingRequiredColumnLabels(MAPPED_ELSEWHERE)).toEqual([MISSING_AMOUNT_COLUMN_LABEL])
  })

  // Any one of the three answers it, so a file writing its two sides separately is not told it is
  // missing a single Amount column it was never going to have
  it('is answered by any one of the three', () => {
    for (const target of ['amount', 'amount_out', 'amount_in'] as const) {
      expect(getMissingRequiredColumnLabels({ ...MAPPED_ELSEWHERE, [target]: 'Debit' })).toEqual([])
    }
  })

  // Two callers join these with commas, so a label carrying one would read as two missing columns
  it('asks for it as one label carrying no comma', () => {
    expect(MISSING_AMOUNT_COLUMN_LABEL).not.toContain(',')
  })

  // There is no notice over the mapping table saying how an amount is read, so each option's own
  // sentence is the only place the arrangements and the sign rule are stated. Stripping one of these
  // would leave a user choosing between Amount, Money out and Money in with nothing saying what a
  // sign in each one means
  it('states every amount arrangement and the sign rule in the dropdown options', () => {
    const options = buildColumnTargetOptions()
    const hintFor = (value: string) => options.find((option) => option.value === value)?.description ?? ''

    expect(hintFor('amount')).toContain('negative for money out')
    expect(hintFor('amount_out')).toContain('A plus sign there is refused')
    expect(hintFor('amount_in')).toContain('A minus sign there is refused')
    expect(hintFor('amount_direction')).toContain('unsigned amounts')
  })

  // How a category's kind reads against an amount's direction belongs against the rows it is about,
  // five steps further down. Kept in one place rather than two, since a rule stated twice drifts
  it('leaves the category direction rule to the rows it is about', () => {
    const options = buildColumnTargetOptions()
    const amountHints = ['amount', 'amount_out', 'amount_in', 'amount_direction']
      .map((value) => options.find((option) => option.value === value)?.description ?? '')

    for (const hint of amountHints) expect(hint).not.toContain('category')
    expect(getRowSignDisagreesWithCategoryReason('expense')).toContain('expense category')
  })

  it('heads the three under one group of their own', () => {
    const options = buildColumnTargetOptions()
    const amountGroups = ['amount', 'amount_out', 'amount_in']
      .map((value) => options.find((option) => option.value === value)?.group)

    expect(new Set(amountGroups).size).toBe(1)
    expect(amountGroups[0]).not.toBe('Optional fields')
  })

  // A single signed column and the two sides are alternatives, so a map holding both states the
  // amount twice with nothing to say which reading wins
  it('reports a map stating the amount two ways at once', () => {
    expect(getAmountArrangementClashError({ ...MAPPED_ELSEWHERE, amount: 'Amount', amount_out: 'Debit' })?.message)
      .toBe(AMOUNT_ARRANGEMENT_CLASH_ERROR)
    expect(getAmountArrangementClashError({ ...MAPPED_ELSEWHERE, amount: 'Amount', amount_in: 'Credit' })?.message)
      .toBe(AMOUNT_ARRANGEMENT_CLASH_ERROR)
  })

  it('says nothing about a map using one arrangement or none', () => {
    expect(getAmountArrangementClashError({ ...MAPPED_ELSEWHERE, amount: 'Amount' })).toBeNull()
    expect(getAmountArrangementClashError({ ...MAPPED_ELSEWHERE, amount_out: 'Debit', amount_in: 'Credit' })).toBeNull()
    expect(getAmountArrangementClashError(MAPPED_ELSEWHERE)).toBeNull()
  })

  // A side column already carries its own direction, so a Direction column beside one specifies it
  // twice. The message has to be the direction one rather than the amount one, since the fix is
  // different: this map has no second amount to drop
  it('reports a Direction column mapped beside a side', () => {
    expect(getAmountArrangementClashError({ ...MAPPED_ELSEWHERE, amount_direction: 'Type', amount_out: 'Debit' })?.message)
      .toBe(DIRECTION_ARRANGEMENT_CLASH_ERROR)
    expect(getAmountArrangementClashError({ ...MAPPED_ELSEWHERE, amount_direction: 'Type', amount_in: 'Credit' })?.message)
      .toBe(DIRECTION_ARRANGEMENT_CLASH_ERROR)
  })

  it('reports nothing about a Direction column beside a single Amount column', () => {
    expect(getAmountArrangementClashError({ ...MAPPED_ELSEWHERE, amount: 'Amount', amount_direction: 'Type' })).toBeNull()
  })

  // The Direction column carries no money, so mapping it answers nothing about how the file states
  // its amount and the missing-amount error still stands
  it('still asks for an amount where only a Direction column is mapped', () => {
    expect(getMissingRequiredColumnLabels({ ...MAPPED_ELSEWHERE, amount_direction: 'Type' }))
      .toEqual([MISSING_AMOUNT_COLUMN_LABEL])
  })
})
