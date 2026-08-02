import { Fragment } from 'react'
import Dropdown, { type DropdownOption } from '@/components/dropdown/Dropdown'
import { CREATE_ACCOUNT_VALUE, IMPORT_INSET_STYLE } from '@/pages/imports/constants'
import { ImportCheckbox } from '@/pages/imports/components/Primitives'

/**
 * Table mapping every source account found in an import to an existing account or a new one, with a
 * batch bar above it that applies a type, currency, and institution to every selected row at once
 *
 * Applying the batch edit switches each selected row to create-new before filling in the chosen
 * fields, so it never overwrites a row that is already mapped to an existing account
 */
export function ImportAccountMappingTable({
  rows,
  options,
  otherSideGroup,
  accountTypeOptions,
  currencyOptions,
  institutionOptions,
  disabled,
  currenciesDisabled,
  institutionsDisabled,
  selectedRowIds,
  batchAccountType,
  batchAccountCurrency,
  batchAccountInstitution,
  onBatchAccountTypeChange,
  onBatchAccountCurrencyChange,
  onBatchAccountInstitutionChange,
  onSelectedRowsChange,
  onCreateInstitution,
  onBatchCreateInstitution,
}: {
  rows: Array<{
    id: string
    source: string
    value: string
    autoFilled?: boolean
    accountType: string
    accountCurrency: string
    accountInstitution: string
    createType: string
    createCurrency: string
    createInstitution: string

    // A source that no row is written to can also answer that the money left the tracked accounts,
    // so its dropdown carries one more choice than the rest
    options?: DropdownOption[]
    isOtherSideOnly?: boolean
    onChange: (value: string) => void
    onCreateTypeChange: (value: string) => void
    onCreateCurrencyChange: (value: string) => void
    onCreateInstitutionChange: (value: string) => void
  }>
  options: DropdownOption[]

  // Heading and explanation opening the run of rows no import row is written to. Left out by a flow
  // that has no such rows, which is every Firefly import
  otherSideGroup?: { title: string; description: string }
  accountTypeOptions: DropdownOption[]
  currencyOptions: DropdownOption[]
  institutionOptions: DropdownOption[]
  disabled: boolean
  currenciesDisabled: boolean
  institutionsDisabled: boolean
  selectedRowIds: Set<string>
  batchAccountType: string
  batchAccountCurrency: string
  batchAccountInstitution: string
  onBatchAccountTypeChange: (value: string) => void
  onBatchAccountCurrencyChange: (value: string) => void
  onBatchAccountInstitutionChange: (value: string) => void
  onSelectedRowsChange: (rows: Set<string>) => void
  onCreateInstitution: (query: string, rowId: string) => void
  onBatchCreateInstitution: (query: string) => void
}) {
  const selectedRows = rows.filter((row) => selectedRowIds.has(row.id))
  const allRowsSelected = rows.length > 0 && selectedRows.length === rows.length
  const someRowsSelected = selectedRows.length > 0 && !allRowsSelected
  const createRows = rows.filter((row) => row.value === CREATE_ACCOUNT_VALUE)
  const mappedCount = rows.filter((row) => row.value && row.value !== CREATE_ACCOUNT_VALUE).length
  const newCount = createRows.length
  const reviewCount = rows.length - mappedCount - newCount

  const toggleRow = (row: (typeof rows)[number]) => {
    const next = new Set(selectedRowIds)
    if (next.has(row.id)) {
      next.delete(row.id)
    } else {
      next.add(row.id)
    }
    onSelectedRowsChange(next)
  }

  const toggleAllRows = () => {
    if (allRowsSelected) {
      onSelectedRowsChange(new Set())
      return
    }

    onSelectedRowsChange(new Set(rows.map((row) => row.id)))
  }

  const applyBatchType = () => {
    if (!batchAccountType && !batchAccountCurrency && !batchAccountInstitution) return
    for (const row of selectedRows) {
      if (row.value !== CREATE_ACCOUNT_VALUE) row.onChange(CREATE_ACCOUNT_VALUE)
      if (batchAccountType) row.onCreateTypeChange(batchAccountType)
      if (batchAccountCurrency) row.onCreateCurrencyChange(batchAccountCurrency)
      if (batchAccountInstitution) row.onCreateInstitutionChange(batchAccountInstitution)
    }
    onBatchAccountTypeChange('')
    onBatchAccountCurrencyChange('')
    onBatchAccountInstitutionChange('')
    onSelectedRowsChange(new Set())
  }

  return (
    <div className="space-y-3">
      <div className="overflow-x-auto">
        <div
          className="grid min-w-[60rem] grid-cols-[3rem_19fr_19fr_18fr_9rem_minmax(0,34fr)] items-center rounded-lg py-3"
          style={IMPORT_INSET_STYLE}
        >
          <div className="col-span-3 min-w-0 px-4">
            <p className="text-sm font-semibold">Batch Edit Accounts</p>
            <p className="mt-1 text-xs" style={{ color: 'var(--app-text-subtle)' }}>
              {selectedRows.length} selected · {mappedCount} mapped · {newCount} new · {reviewCount} review
            </p>
          </div>
          <div className="min-w-0 px-4">
            <Dropdown
              options={accountTypeOptions}
              value={batchAccountType}
              onChange={onBatchAccountTypeChange}
              searchable
              placeholder="Type"
              className="app-input"
            />
          </div>
          <div className="min-w-0 px-2">
            <Dropdown
              options={currencyOptions}
              value={batchAccountCurrency}
              onChange={onBatchAccountCurrencyChange}
              searchable
              placeholder="Currency"
              className="app-input px-2"
              disabled={currenciesDisabled}
            />
          </div>
          <div className="flex min-w-0 items-center gap-3 px-4">
            <div className="min-w-0 flex-1">
              <Dropdown
                options={institutionOptions}
                value={batchAccountInstitution}
                onChange={onBatchAccountInstitutionChange}
                searchable
                placeholder="Institution"
                className="app-input"
                disabled={institutionsDisabled}
                onCreateNew={onBatchCreateInstitution}
                createNewLabel={(query) => query ? `Create institution "${query}"` : 'Create institution'}
              />
            </div>
            <button
              type="button"
              className="app-primary-button h-10 shrink-0"
              onClick={applyBatchType}
              disabled={(!batchAccountType && !batchAccountCurrency && !batchAccountInstitution) || selectedRows.length === 0}
            >
              Apply
            </button>
          </div>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full table-fixed min-w-[60rem] text-left text-[0.9375rem]">
          <colgroup>
            <col className="w-12" />
            <col className="w-[23%]" />
            <col className="w-[28%]" />
            <col className="w-[16%]" />
            <col className="w-[8%]" />
            <col className="w-[18%]" />
          </colgroup>
          <thead style={{ color: 'var(--app-text-subtle)', background: 'var(--app-input-bg)' }}>
            <tr>
              <th className="w-12 px-4 py-3 font-medium">
                <ImportCheckbox
                  checked={allRowsSelected}
                  indeterminate={someRowsSelected}
                  onChange={toggleAllRows}
                  disabled={rows.length === 0}
                  label={allRowsSelected ? 'Deselect all accounts' : 'Select all accounts'}
                />
              </th>
              <th className="px-4 py-3 font-medium">Source Account</th>
              <th className="px-4 py-3 font-medium">Existing Account</th>
              <th className="px-4 py-3 font-medium">Type</th>
              <th className="px-2 py-3 font-medium">Currency</th>
              <th className="px-4 py-3 font-medium">Institution</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, rowIndex) => {
              const creating = row.value === CREATE_ACCOUNT_VALUE

              // The sources arrive with the ones rows are written to first, so the heading goes in
              // front of the first row of the other run rather than being repeated down it
              const opensOtherSideGroup = Boolean(otherSideGroup)
                && row.isOtherSideOnly
                && !rows[rowIndex - 1]?.isOtherSideOnly

              return (
                <Fragment key={row.id}>
                {opensOtherSideGroup && otherSideGroup && (
                  <tr>
                    <td colSpan={6} className="px-4 pb-2 pt-5">
                      <p className="text-[0.8125rem] font-semibold uppercase tracking-wide" style={{ color: 'var(--app-text-subtle)' }}>
                        {otherSideGroup.title}
                      </p>
                      <p className="mt-1 max-w-[60rem] text-sm" style={{ color: 'var(--app-text-muted)' }}>
                        {otherSideGroup.description}
                      </p>
                    </td>
                  </tr>
                )}
                <tr className={row.autoFilled ? 'import-auto-fill-row' : undefined}>
                  <td className="px-4 py-3 align-middle">
                    <ImportCheckbox
                      checked={selectedRowIds.has(row.id)}
                      onChange={() => toggleRow(row)}
                      label={`Select ${row.source}`}
                    />
                  </td>
                  <td className="px-4 py-3 align-middle">
                    <div className="flex min-w-0 items-center gap-2">
                      <p className="truncate font-medium">{row.source}</p>
                      {creating && (
                        <span className="shrink-0 text-[0.6875rem] font-semibold uppercase" style={{ color: 'var(--app-accent)' }}>
                          New
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3 align-middle">
                    <Dropdown
                      options={row.options ?? options}
                      value={row.value}
                      onChange={row.onChange}
                      searchable
                      blankWhenEmpty
                      className={`app-input ${row.autoFilled ? 'import-auto-fill-field' : ''}`}
                      disabled={disabled}
                    />
                  </td>
                  <td className="px-4 py-3 align-middle">
                    <Dropdown
                      options={accountTypeOptions}
                      value={creating ? row.createType : row.accountType}
                      onChange={row.onCreateTypeChange}
                      searchable
                      blankWhenEmpty
                      className={`app-input ${row.autoFilled && !creating ? 'import-auto-fill-field' : ''}`}
                      disabled={!creating}
                    />
                  </td>
                  <td className="px-2 py-3 align-middle">
                    <Dropdown
                      options={currencyOptions}
                      value={creating ? row.createCurrency : row.accountCurrency}
                      onChange={row.onCreateCurrencyChange}
                      searchable
                      blankWhenEmpty
                      className={`app-input px-2 ${row.autoFilled && !creating ? 'import-auto-fill-field' : ''}`}
                      disabled={!creating || currenciesDisabled}
                    />
                  </td>
                  <td className="px-4 py-3 align-middle">
                    <Dropdown
                      options={institutionOptions}
                      value={creating ? row.createInstitution : row.accountInstitution}
                      onChange={row.onCreateInstitutionChange}
                      searchable
                      className={`app-input ${row.autoFilled && !creating ? 'import-auto-fill-field' : ''}`}
                      disabled={!creating || institutionsDisabled}
                      onCreateNew={(query) => onCreateInstitution(query, row.id)}
                      createNewLabel={(query) => query ? `Create institution "${query}"` : 'Create institution'}
                    />
                  </td>
                </tr>
                </Fragment>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
