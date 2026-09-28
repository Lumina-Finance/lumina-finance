import { ImportSkippedTable, type ImportSkippedTableRow } from '@/pages/imports/components/tables/SkippedTable'
import { formatScaledAmount } from '@/pages/imports/actual/utils/amounts'
import type { ActualBudgetDraft } from '@/pages/imports/actual/utils/budgets'

const SKIPPED_BUDGET_HEADERS = ['Months', 'First Month', 'Last Month', 'Latest Amount']

/**
 * Collapsible panel listing the budgets the import will not create, with the reason for each
 */
export function ActualSkippedBudgetsTable({
  budgets,
  budgetDecimals,
}: {
  budgets: Array<{ draft: ActualBudgetDraft; reason: string }>
  budgetDecimals: number
}) {
  const rows: ImportSkippedTableRow[] = budgets.map(({ draft, reason }) => ({
    key: draft.categoryId,
    lead: draft.name,
    reason,
    cells: {
      'Months': String(draft.months.length),
      'First Month': draft.months[0]?.month ?? '',
      'Last Month': draft.months.at(-1)?.month ?? '',
      'Latest Amount': formatScaledAmount(draft.months.at(-1)?.amount ?? 0, budgetDecimals, budgetDecimals) ?? '',
    },
  }))

  return (
    <ImportSkippedTable
      title={`${budgets.length} budget${budgets.length === 1 ? '' : 's'} skipped`}
      toggleLabel="skipped budgets"
      leadHeader="Budget"
      leadColumnWidth="10rem"
      leadCellClassName="font-medium"
      headers={SKIPPED_BUDGET_HEADERS}
      rows={rows}
      totalCount={budgets.length}
    />
  )
}
