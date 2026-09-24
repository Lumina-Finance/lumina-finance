import { useEffect, useId, type Dispatch, type SetStateAction } from 'react'
import Dropdown, { type DropdownOption } from '@/components/dropdown/Dropdown'
import { CREATE_ACCOUNT_VALUE, IMPORT_INSET_STYLE, UNSET_BATCH_INSTITUTION } from '@/pages/imports/constants'
import { OUTSIDE_ACCOUNT_VALUE } from '@/utils/transfers'
import { canApplyBatchEditToRow, countImportAccountRowStates } from '@/pages/imports/utils'
import { formatAccountMappingSummary } from '@/pages/imports/utils/accountMappingSummary'
import { getImportAccountSelection, toggleAllImportAccountRows } from '@/pages/imports/utils/accountSelection'
import { Checkbox } from '@/components/forms/Checkbox'

/**
 * Table mapping every source account found in an import to an existing account or a new one, with a
 * batch bar above it that applies a type, currency, and institution to every selected row at once
 *
 * Applying the batch edit fills in only the rows the user has not settled, switching each of those
 * to create-new first, so an account they picked or that was matched for them is left alone
 */
export function ImportAccountMappingTable({
  rows,
  options,
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

    /**
     * Stands in for an answer the dropdown no longer offers, so the row shows what it holds
     *
     * A source can carry a choice this list has since stopped offering, such as an archived account
     * answered while the source was only a transfer's counterparty. Without this the row reads as
     * unanswered while the commit panel refuses it by name
     */
    selectedOption?: DropdownOption
    autoFilled?: boolean

    /** Whether no row is written to this source, which is what makes the lenient answers legal */
    isCounterpartyOnly: boolean

    /**
     * Whether the account this row points at takes no rows from an import, being archived or shared
     * with the user at read level, false for every other kind of answer
     */
    isReadOnlyAccount: boolean

    /** Whether this row's answer came from the user rather than from a match or a default */
    isHandAnswered: boolean

    accountType: string
    accountCurrency: string
    accountInstitution: string
    createType: string
    createCurrency: string
    createInstitution: string
    onChange: (value: string) => void
    onCreateTypeChange: (value: string) => void
    onCreateCurrencyChange: (value: string) => void
    onCreateInstitutionChange: (value: string) => void
  }>
  options: DropdownOption[]
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
  onSelectedRowsChange: Dispatch<SetStateAction<Set<string>>>
  onCreateInstitution: (query: string, rowId: string) => void
  onBatchCreateInstitution: (query: string) => void
}) {
  const labelNamespace = useId()
  const batchHeadingId = `${labelNamespace}-batch`
  const accountHeadingId = `${labelNamespace}-account`
  const typeHeadingId = `${labelNamespace}-type`
  const currencyHeadingId = `${labelNamespace}-currency`
  const institutionHeadingId = `${labelNamespace}-institution`
  const { eligibleRows, selectedRows, validSelection, allSelected: allRowsSelected, someSelected: someRowsSelected } = getImportAccountSelection(rows, selectedRowIds)
  const { mapped: mappedCount, new: newCount } = countImportAccountRowStates(rows)

  // A reference-data refresh can settle a selected row without calling its mapping handler
  useEffect(() => {
    if (validSelection !== selectedRowIds) {
      onSelectedRowsChange((current) => getImportAccountSelection(rows, current).validSelection)
    }
  }, [onSelectedRowsChange, rows, selectedRowIds, validSelection])

  const editableRows = selectedRows
  const accountMappingSummary = formatAccountMappingSummary({
    selected: selectedRows.length,
    mapped: mappedCount,
    new: newCount,
  })
  const hasBatchInstitutionSet = batchAccountInstitution !== UNSET_BATCH_INSTITUTION
  const hasBatchFieldSet = Boolean(batchAccountType || batchAccountCurrency) || hasBatchInstitutionSet

  /** Updates one eligible row while retaining the other table's current selection */
  const toggleRow = (row: (typeof rows)[number]) => {
    if (disabled || !canApplyBatchEditToRow(row.value, row.isHandAnswered, row.isCounterpartyOnly)) return
    onSelectedRowsChange((current) => {
      const next = new Set(getImportAccountSelection(rows, current).validSelection)
      if (next.has(row.id)) next.delete(row.id)
      else next.add(row.id)
      return next
    })
  }

  /** Toggles eligible rows in this table while retaining the other table's selection */
  const toggleAllRows = () => {
    if (disabled) return
    onSelectedRowsChange((current) => toggleAllImportAccountRows(rows, current))
  }

  const applyBatchType = () => {
    if (!hasBatchFieldSet || editableRows.length === 0) return
    for (const row of editableRows) {
      if (row.value !== CREATE_ACCOUNT_VALUE) row.onChange(CREATE_ACCOUNT_VALUE)
      if (batchAccountType) row.onCreateTypeChange(batchAccountType)
      if (batchAccountCurrency) row.onCreateCurrencyChange(batchAccountCurrency)

      // Unlike the other two, an empty institution is a choice rather than an unset control, so
      // applying None is how a row's institution gets cleared in bulk
      if (hasBatchInstitutionSet) row.onCreateInstitutionChange(batchAccountInstitution)
    }
    onBatchAccountTypeChange('')
    onBatchAccountCurrencyChange('')
    onBatchAccountInstitutionChange(UNSET_BATCH_INSTITUTION)

    // The other table shares this selection and keeps its rows after this table applies its edits
    onSelectedRowsChange((current) => {
      const next = new Set(current)
      for (const row of editableRows) next.delete(row.id)
      return next
    })
  }

  /**
   * Renders one source's mapping row, with the account, type, currency and institution choices
   */
  const renderMappingRow = (row: (typeof rows)[number], index: number) => {
    const creating = row.value === CREATE_ACCOUNT_VALUE
    const selectable = canApplyBatchEditToRow(row.value, row.isHandAnswered, row.isCounterpartyOnly)
    const sourceLabelId = `${labelNamespace}-source-${index}`

    return (
      <tr key={row.id} className={row.autoFilled ? 'import-auto-fill-row' : undefined}>
        <td className="px-4 py-3 align-middle">
          <span className="flex justify-center">
            <Checkbox
              checked={selectable && selectedRowIds.has(row.id)}
              disabled={disabled || !selectable}
              onChange={() => toggleRow(row)}
              label={`Select ${row.source}`}
            />
          </span>
        </td>
        <td className="px-4 py-3 align-middle">
          <div className="flex min-w-0 items-center gap-2">
            <p
              id={sourceLabelId}
              className={`truncate font-medium ${row.value === OUTSIDE_ACCOUNT_VALUE ? 'line-through' : ''}`}
              style={{ color: row.value === OUTSIDE_ACCOUNT_VALUE ? 'var(--app-text-muted)' : undefined }}
              title={row.source}
            >
              {row.source}
            </p>
            {creating && (
              <span className="shrink-0 text-[0.6875rem] font-semibold uppercase" style={{ color: 'var(--app-accent)' }}>
                New
              </span>
            )}
          </div>
        </td>
        <td className="px-4 py-3 align-middle">
          <Dropdown
            labelledBy={`${accountHeadingId} ${sourceLabelId}`}
            options={options}
            value={row.value}
            selectedOption={row.selectedOption}
            onChange={row.onChange}
            searchable
            blankWhenEmpty
            size="compact"
            className={row.autoFilled ? 'import-auto-fill-field' : undefined}
            disabled={disabled}
          />
        </td>
        <td className="px-4 py-3 align-middle">
          <Dropdown
            labelledBy={`${typeHeadingId} ${sourceLabelId}`}
            options={accountTypeOptions}
            value={creating ? row.createType : row.accountType}
            onChange={row.onCreateTypeChange}
            searchable
            // A creating row still has to answer this, so it asks rather than sitting empty. A row
            // mapped to an account shows that account's type, and stays blank while there is none
            blankWhenEmpty={!creating}
            placeholder="Type"
            size="compact"
            className={row.autoFilled && !creating ? 'import-auto-fill-field' : undefined}
            disabled={!creating}
          />
        </td>
        <td className="px-2 py-3 align-middle">
          <Dropdown
            labelledBy={`${currencyHeadingId} ${sourceLabelId}`}
            options={currencyOptions}
            value={creating ? row.createCurrency : row.accountCurrency}
            onChange={row.onCreateCurrencyChange}
            searchable
            blankWhenEmpty={!creating}
            placeholder="Currency"
            size="compact"
            className={row.autoFilled && !creating ? 'import-auto-fill-field' : undefined}
            disabled={!creating || currenciesDisabled}
          />
        </td>
        <td className="px-4 py-3 align-middle">
          <Dropdown
            labelledBy={`${institutionHeadingId} ${sourceLabelId}`}
            options={institutionOptions}
            value={creating ? row.createInstitution : row.accountInstitution}
            onChange={row.onCreateInstitutionChange}
            searchable
            // The institution list spends the empty string on "None", so without this an unanswered
            // row reads as having been given one, and its tooltip repeats the claim
            blankWhenEmpty={!creating}
            placeholder="Institution"
            size="compact"
            className={row.autoFilled && !creating ? 'import-auto-fill-field' : undefined}
            disabled={!creating || institutionsDisabled}
            onCreateNew={(query) => onCreateInstitution(query, row.id)}
            createNewLabel={(query) => query ? `Create institution "${query}"` : 'Create institution'}
          />
        </td>
      </tr>
    )
  }

  return (
    <div className="space-y-3">
      <div className="overflow-x-auto">
        <div
          className="grid min-w-[60rem] grid-cols-[3rem_19fr_19fr_18fr_9rem_minmax(0,34fr)] items-center rounded-lg py-3"
          style={IMPORT_INSET_STYLE}
        >
          <div className="col-span-3 min-w-0 px-4">
            <p id={batchHeadingId} className="text-sm font-semibold">Batch Edit Accounts</p>
            <p className="mt-1 text-xs" style={{ color: 'var(--app-text-subtle)' }}>
              {accountMappingSummary}
            </p>
          </div>
          <div className="min-w-0 px-4">
            <Dropdown
              labelledBy={`${batchHeadingId} ${typeHeadingId}`}
              options={accountTypeOptions}
              value={batchAccountType}
              onChange={onBatchAccountTypeChange}
              searchable
              placeholder="Type"
              size="field"
            />
          </div>
          <div className="min-w-0 px-2">
            <Dropdown
              labelledBy={`${batchHeadingId} ${currencyHeadingId}`}
              options={currencyOptions}
              value={batchAccountCurrency}
              onChange={onBatchAccountCurrencyChange}
              searchable
              placeholder="Currency"
              size="field"
              disabled={currenciesDisabled}
            />
          </div>
          <div className="flex min-w-0 items-center gap-3 px-4">
            <div className="min-w-0 flex-1">
              <Dropdown
                labelledBy={`${batchHeadingId} ${institutionHeadingId}`}
                options={institutionOptions}
                value={batchAccountInstitution}
                onChange={onBatchAccountInstitutionChange}
                searchable
                placeholder="Institution"
                size="field"
                disabled={institutionsDisabled}
                onCreateNew={onBatchCreateInstitution}
                createNewLabel={(query) => query ? `Create institution "${query}"` : 'Create institution'}
              />
            </div>
            <button
              type="button"
              className="app-primary-button h-10 shrink-0"
              onClick={applyBatchType}
              disabled={!hasBatchFieldSet || editableRows.length === 0}
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
                <span className="flex justify-center">
                  <Checkbox
                    checked={allRowsSelected}
                    indeterminate={someRowsSelected}
                    onChange={toggleAllRows}
                    disabled={disabled || eligibleRows.length === 0}
                    label={allRowsSelected ? 'Deselect all accounts' : 'Select all accounts'}
                  />
                </span>
              </th>
              <th className="px-4 py-3 font-medium">Source Account</th>
              <th id={accountHeadingId} className="px-4 py-3 font-medium">Existing Account</th>
              <th id={typeHeadingId} className="px-4 py-3 font-medium">Type</th>
              <th id={currencyHeadingId} className="px-2 py-3 font-medium">Currency</th>
              <th id={institutionHeadingId} className="px-4 py-3 font-medium">Institution</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(renderMappingRow)}
          </tbody>
        </table>
      </div>
    </div>
  )
}
