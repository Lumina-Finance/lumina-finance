/**
 * Tests the account step's table rows, which the CSV and provider imports build the same way, so a
 * row shows the answer it holds and its controls change only that row's answer
 */
import { describe, expect, it, vi } from 'vitest'
import type { AccountsOverview } from '@/api/accounts'
import { CREATE_ACCOUNT_VALUE } from '@/pages/imports/constants'
import { buildImportAccountMappingRows } from '@/pages/imports/utils'

function createAccount(overrides: Partial<AccountsOverview> = {}): AccountsOverview {
  return {
    id: 'checking',
    owner_id: null,
    group_id: null,
    account_kind: 'asset',
    account_type: 'checking',
    tax_advantaged_category_id: null,
    name: 'Chequing',
    institution: { id: 'bank', status: 'active', name: 'Bank', country_code: 'CA', website: '', logo_url: null },
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

function buildRows(
  sources: Parameters<typeof buildImportAccountMappingRows>[0],
  overrides: Partial<Parameters<typeof buildImportAccountMappingRows>[1]> = {},
) {
  return buildImportAccountMappingRows(sources, {
    accountMappings: {},
    accountById: new Map(),
    autoFilledAccountSources: new Set(),
    handAnsweredAccountSources: new Set(),
    getCreateDetails: () => undefined,
    onAccountMappingChange: vi.fn(),
    setAccountCreateTypes: vi.fn(),
    setAccountCreateCurrencies: vi.fn(),
    setAccountCreateInstitutions: vi.fn(),
    ...overrides,
  })
}

describe('the account step table rows', () => {
  it('shows a matched account with its type, currency and institution', () => {
    const account = createAccount()
    const [row] = buildRows([{ id: 'Chequing', label: 'Chequing' }], {
      accountMappings: { Chequing: 'checking' },
      accountById: new Map([['checking', account]]),
      autoFilledAccountSources: new Set(['Chequing']),
    })

    expect(row).toMatchObject({
      id: 'Chequing',
      source: 'Chequing',
      value: 'checking',
      selectedOption: { value: 'checking', label: 'Chequing' },
      autoFilled: true,
      isCounterpartyOnly: false,
      isReadOnlyAccount: false,
      isHandAnswered: false,
      accountType: 'checking',
      accountCurrency: 'CAD',
      accountInstitution: 'bank',
    })
  })

  // An archived account is no longer offered, so the row keeps it visible and flags it
  it('keeps an archived account on its row and marks it read-only', () => {
    const [row] = buildRows([{ id: 'Old', label: 'Old' }], {
      accountMappings: { Old: 'old' },
      accountById: new Map([['old', createAccount({ id: 'old', name: 'Old savings', is_archived: true })]]),
    })

    expect(row.selectedOption).toEqual({ value: 'old', label: 'Old savings' })
    expect(row.isReadOnlyAccount).toBe(true)
  })

  it('shows what was chosen for a new account and leaves an unanswered row blank', () => {
    const rows = buildRows([
      { id: 'Visa', label: 'Visa' },
      { id: 'Unanswered', label: 'Unanswered' },
    ], {
      accountMappings: { Visa: CREATE_ACCOUNT_VALUE },
      handAnsweredAccountSources: new Set(['Visa']),
      getCreateDetails: (source) => (source === 'Visa'
        ? { accountType: 'credit_card', currency: 'USD', institutionId: 'bank' }
        : undefined),
    })

    expect(rows[0]).toMatchObject({
      value: CREATE_ACCOUNT_VALUE,
      selectedOption: undefined,
      isHandAnswered: true,
      createType: 'credit_card',
      createCurrency: 'USD',
      createInstitution: 'bank',
    })
    expect(rows[1]).toMatchObject({ value: '', createType: '', createCurrency: '', createInstitution: '' })
  })

  it('changes only its own source\'s answers', () => {
    const onAccountMappingChange = vi.fn()
    const setAccountCreateTypes = vi.fn()
    const setAccountCreateCurrencies = vi.fn()
    const setAccountCreateInstitutions = vi.fn()
    const [row] = buildRows([{ id: 'Visa', label: 'Visa' }], {
      onAccountMappingChange,
      setAccountCreateTypes,
      setAccountCreateCurrencies,
      setAccountCreateInstitutions,
    })

    row.onChange(CREATE_ACCOUNT_VALUE)
    row.onCreateTypeChange('credit_card')
    row.onCreateCurrencyChange('USD')
    row.onCreateInstitutionChange('bank')

    expect(onAccountMappingChange).toHaveBeenCalledWith('Visa', CREATE_ACCOUNT_VALUE)
    const current = { Chequing: 'kept' }
    expect(setAccountCreateTypes.mock.calls[0][0](current)).toEqual({ Chequing: 'kept', Visa: 'credit_card' })
    expect(setAccountCreateCurrencies.mock.calls[0][0](current)).toEqual({ Chequing: 'kept', Visa: 'USD' })
    expect(setAccountCreateInstitutions.mock.calls[0][0](current)).toEqual({ Chequing: 'kept', Visa: 'bank' })
  })
})
