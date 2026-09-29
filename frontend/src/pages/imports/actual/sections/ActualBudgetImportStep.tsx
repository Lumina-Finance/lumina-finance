import { ImportInfoCard, ImportNotice, type ImportBudgetColumn } from '@/pages/imports/components'
import type { ImportSkippedTableRow } from '@/pages/imports/components/tables/SkippedTable'
import { ImportBudgetStep } from '@/pages/imports/sections'
import type { ActualImportWorkflow } from '@/pages/imports/actual/hooks'
import { formatScaledAmount } from '@/pages/imports/actual/utils/amounts'
import type { ActualBudgetDraft } from '@/pages/imports/actual/utils/budgets'

const SKIPPED_BUDGET_HEADERS = ['Months', 'First Month', 'Last Month', 'Latest Amount']

type ActualBudgetImportStepProps = Pick<
  ActualImportWorkflow,
  | 'budget'
  | 'importResult'
  | 'budgetDrafts'
  | 'budgetRefusals'
  | 'budgetsMissingPayments'
  | 'selectedBudgetIds'
  | 'toggleBudgetSelection'
  | 'setBudgetsSelected'
  | 'importedBudgetNames'
  | 'budgetSelectionError'
  | 'importOverlayOpen'
>

/**
 * Previews the budgets the import will create from what Actual budgeted each month, and lets the
 * user choose them
 *
 * A budget the import can't create comes back from the skipped panel when an answer elsewhere
 * changes its reason
 */
export function ActualBudgetImportStep({
  budget,
  importResult,
  budgetDrafts,
  budgetRefusals,
  budgetsMissingPayments,
  selectedBudgetIds,
  toggleBudgetSelection,
  setBudgetsSelected,
  importedBudgetNames,
  budgetSelectionError,
  importOverlayOpen,
}: ActualBudgetImportStepProps) {
  if (!budget) return null

  const budgetDecimals = budget.budgetDecimals
  const formatAmount = (amount: number) => formatScaledAmount(amount, budgetDecimals, budgetDecimals) ?? ''
  const importableDrafts = budgetDrafts.filter((draft) => !budgetRefusals.get(draft.categoryId))
  const skippedRows: ImportSkippedTableRow[] = budgetDrafts.flatMap((draft) => {
    const reason = budgetRefusals.get(draft.categoryId)
    if (!reason) return []
    return [{
      key: draft.categoryId,
      lead: draft.name,
      reason,
      cells: {
        'Months': String(draft.months.length),
        'First Month': draft.months[0]?.month ?? '',
        'Last Month': draft.months.at(-1)?.month ?? '',
        'Latest Amount': formatAmount(draft.months.at(-1)?.amount ?? 0),
      },
    }]
  })

  const columns: ImportBudgetColumn<ActualBudgetDraft>[] = [
    { header: 'Repeats', widthClassName: 'w-[15%]', tone: 'muted', render: (draft) => (draft.recurs ? 'Monthly' : 'Not recurring') },
    {
      header: 'Latest Amount',
      widthClassName: 'w-[16%]',
      align: 'right',
      tone: 'figure',
      render: (draft) => {
        const latest = draft.months.at(-1)
        return latest ? formatAmount(latest.amount) : ''
      },
    },
    { header: 'Months', widthClassName: 'w-[11%]', align: 'right', tone: 'figure', render: (draft) => draft.months.length },
    { header: 'First Month', widthClassName: 'w-[14%]', tone: 'figure', render: (draft) => draft.months[0]?.month ?? '' },
    { header: 'Last Month', widthClassName: 'w-[14%]', tone: 'figure', render: (draft) => draft.months.at(-1)?.month ?? '' },
  ]

  return (
    <ImportBudgetStep
      description="Your Actual budgets, month by month. They're imported along with your transactions."
      detectedCount={budgetDrafts.length}
      skippedHeaders={SKIPPED_BUDGET_HEADERS}
      skippedRows={skippedRows}
      selectionError={budgetSelectionError}
      noBudgetsDescription="Nothing in this budget was given an amount above zero."
      allSkippedDescription="Every budget is skipped, for the reasons listed above."
      budgets={importableDrafts}
      getKey={(draft) => draft.categoryId}
      columns={columns}
      nameWidthClassName="w-[26%]"
      minWidthClassName="min-w-[52rem]"
      // After an import the boxes show what was created rather than what was chosen
      isChecked={(draft) => importedBudgetNames.has(draft.name) || (!importResult && selectedBudgetIds.has(draft.categoryId))}
      selectionLocked={importOverlayOpen || Boolean(importResult)}
      onToggle={toggleBudgetSelection}
      onSetAll={setBudgetsSelected}
    >
      {budgetsMissingPayments.length > 0 && (
        <ImportNotice title="Some budgets won't count these payments" items={budgetsMissingPayments}>
          These categories had payments to off-budget accounts that you're importing as transfers, so their budgets will show less spent than Actual did. To count them, switch their "transfers in Actual" rows to Expense under Category Matching:
        </ImportNotice>
      )}

      <ImportInfoCard title="How your budget months are imported">
        Each month you budgeted more than zero becomes a period, with that amount as its limit. A month budgeted at zero is left as a gap in the budget's history. If you budgeted a category for this month or later, its budget keeps recurring monthly at its latest limit. Otherwise it ends after the last month you budgeted. Categories you hid in Actual are imported as archived budgets. Rollover and To Budget aren't imported, since each period in Lumina Finance starts fresh.
      </ImportInfoCard>
    </ImportBudgetStep>
  )
}
