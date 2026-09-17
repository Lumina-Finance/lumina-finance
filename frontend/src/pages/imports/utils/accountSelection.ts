import { canApplyBatchEditToRow } from './accountMapping'

interface AccountSelectionRow {
  id: string
  value: string
  isHandAnswered: boolean
  isCounterpartyOnly: boolean
}

/** Keeps batch selection limited to eligible rows without touching another table's selection */
export function getImportAccountSelection<T extends AccountSelectionRow>(rows: T[], selection: Set<string>) {
  const eligibleRows = rows.filter((row) => canApplyBatchEditToRow(row.value, row.isHandAnswered, row.isCounterpartyOnly))
  const eligibleIds = new Set(eligibleRows.map((row) => row.id))
  const selectedRows = eligibleRows.filter((row) => selection.has(row.id))
  const excludedIds = rows.filter((row) => !eligibleIds.has(row.id) && selection.has(row.id)).map((row) => row.id)
  const validSelection = excludedIds.length ? new Set(selection) : selection
  for (const id of excludedIds) validSelection.delete(id)
  const allSelected = eligibleRows.length > 0 && selectedRows.length === eligibleRows.length
  return {
    eligibleRows,
    selectedRows,
    validSelection,
    allSelected,
    someSelected: selectedRows.length > 0 && !allSelected,
  }
}

/** Toggles only this table's eligible rows and retains selections owned by other tables */
export function toggleAllImportAccountRows(rows: AccountSelectionRow[], selection: Set<string>) {
  const { eligibleRows, validSelection, allSelected } = getImportAccountSelection(rows, selection)
  const next = new Set(validSelection)
  for (const row of eligibleRows) {
    if (allSelected) next.delete(row.id)
    else next.add(row.id)
  }
  return next
}
