/**
 * Tests that the category and account tables glow a row they filled in for the user to check, and not
 * while every answer is held or on a finished import's record, where nothing is left to check and the
 * glow shows as a stray bronze outline
 */
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { ImportAccountMappingTable } from '@/pages/imports/components/tables/AccountMappingTable'
import { ImportDirectionValueTable } from '@/pages/imports/components/tables/DirectionValueTable'
import { ImportHeaderMappingTable } from '@/pages/imports/components/tables/HeaderMappingTable'
import { ImportValueMatchTable } from '@/pages/imports/components/tables/ValueMatchTable'
import { EMPTY_COLUMN_MAP } from '@/pages/imports/constants'

/** Renders the column mapping table with its one column matched for the user */
function renderColumns(disabled: boolean) {
  return renderToStaticMarkup(createElement(ImportHeaderMappingTable, {
    headers: ['Notes'],
    files: [],
    options: [],
    autoFilledHeaders: new Set(['Notes']),
    columnMap: { ...EMPTY_COLUMN_MAP, notes: 'Notes' },
    validationErrors: {},
    dateFormat: null,
    dateFormatAutomatic: true,
    amountFormat: null,
    amountFormatAutomatic: true,
    disabled,
    onChange: () => undefined,
    onDateFormatChange: () => undefined,
    onAmountFormatChange: () => undefined,
  } as unknown as Parameters<typeof ImportHeaderMappingTable>[0]))
}

/** Renders the direction word table with its one word matched for the user */
function renderDirections(disabled: boolean) {
  return renderToStaticMarkup(createElement(ImportDirectionValueTable, {
    values: [{ key: 'debit', label: 'DEBIT' }],
    answers: { debit: 'out' },
    autoFilledValues: new Set(['debit']),
    disabled,
    onChange: () => undefined,
  } as unknown as Parameters<typeof ImportDirectionValueTable>[0]))
}

/** Renders the category table with one row filled in for the user */
function renderCategories(disabled: boolean) {
  return renderToStaticMarkup(createElement(ImportValueMatchTable, {
    sourceLabel: 'Category from export',
    targetLabel: 'Existing category',
    rows: [{ id: 'Food', source: 'Food', value: '', autoFilled: true, onChange: () => undefined }],
    options: [],
    disabled,
  } as unknown as Parameters<typeof ImportValueMatchTable>[0]))
}

/** Renders the account table with one row filled in for the user */
function renderAccounts(disabled: boolean) {
  return renderToStaticMarkup(createElement(ImportAccountMappingTable, {
    rows: [{
      id: 'Checking',
      source: 'Checking',
      value: '',
      autoFilled: true,
      isCounterpartyOnly: false,
      isReadOnlyAccount: false,
      isHandAnswered: false,
      accountType: '',
      accountCurrency: '',
      accountInstitution: '',
      createType: '',
      createCurrency: '',
      createInstitution: '',
      onChange: () => undefined,
      onCreateTypeChange: () => undefined,
      onCreateCurrencyChange: () => undefined,
      onCreateInstitutionChange: () => undefined,
    }],
    options: [],
    accountTypeOptions: [],
    currencyOptions: [],
    institutionOptions: [],
    disabled,
    currenciesDisabled: false,
    institutionsDisabled: false,
    selectedRowIds: new Set<string>(),
    batchAccountType: '',
    batchAccountCurrency: '',
    batchAccountInstitution: '',
    onBatchAccountTypeChange: () => undefined,
    onBatchAccountCurrencyChange: () => undefined,
    onBatchAccountInstitutionChange: () => undefined,
    onSelectedRowsChange: () => undefined,
    onCreateInstitution: () => undefined,
    onBatchCreateInstitution: () => undefined,
  } as unknown as Parameters<typeof ImportAccountMappingTable>[0]))
}

describe('the glow on a row the table filled in for the user', () => {
  it('shows on a category row while the step is open', () => {
    expect(renderCategories(false)).toContain('import-auto-fill-row')
    expect(renderCategories(false)).toContain('import-auto-fill-field')
  })

  it('stays off a category row while the answers are held', () => {
    expect(renderCategories(true)).not.toContain('import-auto-fill')
  })

  it('shows on an account row while the step is open', () => {
    expect(renderAccounts(false)).toContain('import-auto-fill-row')
  })

  it('stays off an account row while the answers are held', () => {
    expect(renderAccounts(true)).not.toContain('import-auto-fill')
  })

  it('shows on a column mapping row while the step is open, and stays off a finished import', () => {
    expect(renderColumns(false)).toContain('import-auto-fill-row')
    expect(renderColumns(true)).not.toContain('import-auto-fill')
  })

  it('shows on a direction word row while the step is open, and stays off a finished import', () => {
    expect(renderDirections(false)).toContain('import-auto-fill-row')
    expect(renderDirections(true)).not.toContain('import-auto-fill')
  })
})
