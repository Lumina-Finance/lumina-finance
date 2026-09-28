import { ImportInfoCard, type ImportBudgetColumn } from '@/pages/imports/components'
import type { ImportSkippedTableRow } from '@/pages/imports/components/tables/SkippedTable'
import { ImportBudgetStep } from '@/pages/imports/sections'
import type { FireflyImportWorkflow } from '@/pages/imports/firefly/hooks'
import type { FireflyBudgetDraft } from '@/pages/imports/firefly/types'

const SKIPPED_BUDGET_HEADERS = [
  'Status',
  'Currencies',
  'Periods',
  'Cadence',
  'First Period',
  'Last Period',
  'Latest Amount',
]

const BUDGET_COLUMNS: ImportBudgetColumn<FireflyBudgetDraft>[] = [
  { header: 'Cadence', widthClassName: 'w-[11%]', tone: 'muted', render: (draft) => draft.periodLabel ?? '' },
  { header: 'Latest Amount', widthClassName: 'w-[14%]', align: 'right', tone: 'figure', render: (draft) => draft.amount },
  { header: 'Categories', widthClassName: 'w-[26%]', tone: 'muted', truncate: true, render: (draft) => draft.categoryNames.join(', ') },
  { header: 'First Period', widthClassName: 'w-[13%]', tone: 'figure', render: (draft) => draft.firstPeriodStart ?? '' },
  {
    header: 'Changes',
    widthClassName: 'w-[14%]',
    tone: 'muted',
    render: (draft) => {
      // A schedule with more than one distinct amount means the limit changed over time
      const distinctAmountCount = new Set(draft.limits.map((limit) => limit.amount)).size
      return distinctAmountCount > 1 ? `${distinctAmountCount} over time` : 'None'
    },
  },
]

type FireflyBudgetImportStepProps = Pick<
  FireflyImportWorkflow,
  | 'importResult'
  | 'budgetsFile'
  | 'budgetDrafts'
  | 'selectedBudgetNames'
  | 'toggleBudgetSelection'
  | 'setBudgetsSelected'
  | 'importedBudgetNames'
  | 'budgetSelectionError'
  | 'budgetCountingNotes'
  | 'importOverlayOpen'
>

/**
 * Previews the budgets the import will create from the budgets export, and lets the user choose them
 */
export function FireflyBudgetImportStep({
  importResult,
  budgetsFile,
  budgetDrafts,
  selectedBudgetNames,
  toggleBudgetSelection,
  setBudgetsSelected,
  importedBudgetNames,
  budgetSelectionError,
  budgetCountingNotes,
  importOverlayOpen,
}: FireflyBudgetImportStepProps) {
  if (!budgetsFile) return null

  const importableDrafts = budgetDrafts.filter((draft) => !draft.disabledReason)
  const skippedRows: ImportSkippedTableRow[] = budgetDrafts.flatMap((draft) => {
    if (!draft.disabledReason) return []
    return [{
      key: draft.name,
      lead: draft.name,
      reason: draft.disabledReason,
      cells: {
        'Status': draft.isArchived ? 'Archived' : 'Active',
        'Currencies': draft.currencyCodes.join(', '),
        'Periods': draft.limits.length > 0 ? String(draft.limits.length) : '',
        'Cadence': draft.periodLabel ?? '',
        'First Period': draft.firstPeriodStart ?? '',
        'Last Period': draft.lastPeriodEnd ?? '',
        'Latest Amount': draft.amount,
      },
    }]
  })

  return (
    <ImportBudgetStep
      description="Budgets derived from the budgets export and the staged transactions, imported together with them."
      detectedCount={budgetDrafts.length}
      skippedHeaders={SKIPPED_BUDGET_HEADERS}
      skippedRows={skippedRows}
      selectionError={budgetSelectionError}
      noBudgetsDescription="The budgets CSV has no budget limit rows."
      allSkippedDescription="Every budget in the export is skipped, for the reasons listed below."
      budgets={importableDrafts}
      getKey={(draft) => draft.name}
      columns={BUDGET_COLUMNS}
      nameWidthClassName="w-[18%]"
      minWidthClassName="min-w-[58rem]"
      // After an import the boxes show what was created rather than what was chosen
      isChecked={(draft) => importedBudgetNames.has(draft.name) || (!importResult && selectedBudgetNames.has(draft.name))}
      selectionLocked={importOverlayOpen || Boolean(importResult)}
      onToggle={toggleBudgetSelection}
      onSetAll={setBudgetsSelected}
    >
      <ImportInfoCard title="Periods as exported">
        Each budget keeps its limit periods exactly as exported, with their original dates and amounts, and continues on the cadence of its most recent period. A budget whose most recent period fits no Lumina Finance cadence is imported without recurring, shown as Not recurring below.
      </ImportInfoCard>

      <ImportInfoCard title="Merged categories">
        If you merged categories in the category matching step, a budget tracking them counts spending across the whole merged category, so its remaining amount will read differently than it does in Firefly III. This is expected behaviour.
      </ImportInfoCard>

      {budgetCountingNotes.length > 0 && (
        <ImportInfoCard title="Spending counted differently">
          {budgetCountingNotes.map((note) => <span key={note} className="mt-1 block first:mt-0">{note}</span>)}
        </ImportInfoCard>
      )}
    </ImportBudgetStep>
  )
}
