import Dropdown, { type DropdownOption } from '@/components/Dropdown'
import { CREATE_ACCOUNT_VALUE, IMPORT_INSET_STYLE } from '../constants'
import { ImportCheckbox } from './ImportPrimitives'

export function AccountMappingTable({
  rows,
  options,
  accountTypeOptions,
  currencyOptions,
  disabled,
  currenciesDisabled,
  selectedRowIds,
  batchAccountType,
  batchAccountCurrency,
  onBatchAccountTypeChange,
  onBatchAccountCurrencyChange,
  onSelectedRowsChange,
}: {
  rows: Array<{
    id: string
    source: string
    value: string
    autoFilled?: boolean
    accountType: string
    accountCurrency: string
    createType: string
    createCurrency: string
    onChange: (value: string) => void
    onCreateTypeChange: (value: string) => void
    onCreateCurrencyChange: (value: string) => void
  }>
  options: DropdownOption[]
  accountTypeOptions: DropdownOption[]
  currencyOptions: DropdownOption[]
  disabled: boolean
  currenciesDisabled: boolean
  selectedRowIds: Set<string>
  batchAccountType: string
  batchAccountCurrency: string
  onBatchAccountTypeChange: (value: string) => void
  onBatchAccountCurrencyChange: (value: string) => void
  onSelectedRowsChange: (rows: Set<string>) => void
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
    if (!batchAccountType && !batchAccountCurrency) return
    for (const row of selectedRows) {
      if (row.value !== CREATE_ACCOUNT_VALUE) row.onChange(CREATE_ACCOUNT_VALUE)
      if (batchAccountType) row.onCreateTypeChange(batchAccountType)
      if (batchAccountCurrency) row.onCreateCurrencyChange(batchAccountCurrency)
    }
    onBatchAccountTypeChange('')
    onBatchAccountCurrencyChange('')
    onSelectedRowsChange(new Set())
  }

  return (
    <div className="space-y-3">
      <div className="overflow-x-auto">
        <div
          className="grid min-w-[68rem] grid-cols-[3rem_27fr_29fr_20fr_24fr] items-center rounded-lg py-3"
          style={IMPORT_INSET_STYLE}
        >
          <div className="col-span-3 min-w-0 px-4">
            <p className="text-sm font-semibold">Batch Create Accounts</p>
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
          <div className="flex min-w-0 items-center gap-3 px-4">
            <div className="min-w-0 flex-1">
              <Dropdown
                options={currencyOptions}
                value={batchAccountCurrency}
                onChange={onBatchAccountCurrencyChange}
                searchable
                placeholder="Currency"
                className="app-input"
                disabled={currenciesDisabled}
              />
            </div>
            <button
              type="button"
              className="app-primary-button h-10 shrink-0"
              onClick={applyBatchType}
              disabled={(!batchAccountType && !batchAccountCurrency) || selectedRows.length === 0}
            >
              Apply
            </button>
          </div>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full table-fixed min-w-[68rem] text-left text-[0.9375rem]">
          <colgroup>
            <col className="w-12" />
            <col className="w-[27%]" />
            <col className="w-[29%]" />
            <col className="w-[20%]" />
            <col className="w-[24%]" />
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
              <th className="px-4 py-3 font-medium">Currency</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const creating = row.value === CREATE_ACCOUNT_VALUE

              return (
                <tr key={row.id} className={row.autoFilled ? 'import-auto-fill-row' : undefined}>
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
                      options={options}
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
                  <td className="px-4 py-3 align-middle">
                    <Dropdown
                      options={currencyOptions}
                      value={creating ? row.createCurrency : row.accountCurrency}
                      onChange={row.onCreateCurrencyChange}
                      searchable
                      blankWhenEmpty
                      className={`app-input ${row.autoFilled && !creating ? 'import-auto-fill-field' : ''}`}
                      disabled={!creating || currenciesDisabled}
                    />
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
