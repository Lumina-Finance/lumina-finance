/**
 * Tests how the account mapping table wires its two institution pickers, the one on each row and the
 * one on the batch bar, so a matched account's institution is named without a request and an untouched
 * batch bar shows its placeholder rather than "None"
 *
 * The picker reads the session and the query cache. A table-only render has neither, so a stand-in
 * records the props the table gives it
 */
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Institution } from '@/api/institutions'

const { pickerProps } = vi.hoisted(() => ({ pickerProps: [] as Array<Record<string, unknown>> }))

vi.mock('@/components/institution-dropdown/InstitutionDropdown', () => ({
  InstitutionDropdown: (props: Record<string, unknown>) => {
    pickerProps.push(props)
    return null
  },
}))

import { ImportAccountMappingTable } from '@/pages/imports/components/tables/AccountMappingTable'
import { UNSET_BATCH_INSTITUTION } from '@/pages/imports/constants'

const bank: Institution = {
  id: 'bank',
  status: 'active',
  name: 'Bank',
  country_code: 'CA',
  website: '',
  logo_url: null,
}

/** Renders one matched row selected, so both its picker and the batch bar's are drawn */
function render(batchAccountInstitution: string) {
  renderToStaticMarkup(
    createElement(ImportAccountMappingTable, {
      rows: [
        {
          id: 'Checking',
          source: 'Checking',
          value: 'checking',
          autoFilled: false,
          isCounterpartyOnly: false,
          isReadOnlyAccount: false,
          isHandAnswered: false,
          accountType: 'checking',
          accountCurrency: 'CAD',
          accountInstitution: 'bank',
          accountInstitutionRecord: bank,
          createType: '',
          createCurrency: '',
          createInstitution: '',
          onChange: () => undefined,
          onCreateTypeChange: () => undefined,
          onCreateCurrencyChange: () => undefined,
          onCreateInstitutionChange: () => undefined,
        },
      ],
      options: [],
      accountTypeOptions: [],
      currencyOptions: [],
      disabled: false,
      currenciesDisabled: false,
      selectedRowIds: new Set(['Checking']),
      batchAccountType: '',
      batchAccountCurrency: '',
      batchAccountInstitution,
      onBatchAccountTypeChange: () => undefined,
      onBatchAccountCurrencyChange: () => undefined,
      onBatchAccountInstitutionChange: () => undefined,
      onSelectedRowsChange: () => undefined,
      onCreateInstitution: () => undefined,
      onBatchCreateInstitution: () => undefined,
    } as unknown as Parameters<typeof ImportAccountMappingTable>[0]),
  )
}

beforeEach(() => {
  pickerProps.length = 0
})

describe('the institution pickers of the account mapping table', () => {
  it('names a matched account’s institution from the account, so its row asks for nothing', () => {
    render(UNSET_BATCH_INSTITUTION)

    const row = pickerProps.find((props) => props.value === 'bank')
    expect(row?.selectedInstitution).toBe(bank)
  })

  it('leaves the batch bar on its placeholder until an institution is chosen', () => {
    render(UNSET_BATCH_INSTITUTION)

    const batch = pickerProps.find((props) => props.size === 'field')
    expect(batch?.value).toBeNull()
  })

  it('shows the batch bar’s institution once one is chosen, and None when None is chosen', () => {
    render('bank')
    expect(pickerProps.find((props) => props.size === 'field')?.value).toBe('bank')

    pickerProps.length = 0
    render('')
    expect(pickerProps.find((props) => props.size === 'field')?.value).toBe('')
  })
})
