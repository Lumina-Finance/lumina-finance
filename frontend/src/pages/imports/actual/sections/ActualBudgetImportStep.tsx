import { EyeOff } from 'lucide-react'
import { Checkbox } from '@/components/forms/Checkbox'
import { EmptyState, ImportInfoCard, ImportStep } from '@/pages/imports/components'
import { ActualSkippedBudgetsTable } from '@/pages/imports/actual/components'
import type { ActualImportWorkflow } from '@/pages/imports/actual/hooks'
import { formatScaledAmount } from '@/pages/imports/actual/utils/amounts'

type ActualBudgetImportStepProps = Pick<
  ActualImportWorkflow,
  | 'budget'
  | 'importResult'
  | 'budgetDrafts'
  | 'budgetRefusals'
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
 * Budgets the import can't create move into their own skipped panel with the reason, and come back
 * when an answer elsewhere changes it. The import creates the selected budgets in the same save as
 * the transactions, so this step has no import button of its own
 */
export function ActualBudgetImportStep({
  budget,
  importResult,
  budgetDrafts,
  budgetRefusals,
  selectedBudgetIds,
  toggleBudgetSelection,
  setBudgetsSelected,
  importedBudgetNames,
  budgetSelectionError,
  importOverlayOpen,
}: ActualBudgetImportStepProps) {
  if (!budget) return null

  const budgetDecimals = budget.budgetDecimals
  const importableDrafts = budgetDrafts.filter((draft) => !budgetRefusals.get(draft.categoryId))
  const skippedBudgets = budgetDrafts.flatMap((draft) => {
    const reason = budgetRefusals.get(draft.categoryId)
    return reason ? [{ draft, reason }] : []
  })
  const tracksTransfers = importableDrafts.some((draft) => draft.categorySourceIds.length > 1)

  // Selection drives what the import creates, so it locks while an import runs and once one has finished
  const selectionLocked = importOverlayOpen || Boolean(importResult)

  // After an import the boxes show what was created rather than what was chosen
  const isChecked = (draft: (typeof importableDrafts)[number]) => (
    importedBudgetNames.has(draft.name) || (!importResult && selectedBudgetIds.has(draft.categoryId))
  )
  const allChecked = importableDrafts.length > 0 && importableDrafts.every(isChecked)
  const someChecked = !allChecked && importableDrafts.some(isChecked)

  return (
    <ImportStep
      index="04"
      title="Budget Import"
      description="Budgets built from what you budgeted each month in Actual, imported together with the transactions."
    >
      <ImportInfoCard title="Months as budgeted">
        Each month you budgeted a category above zero becomes one monthly period with that amount. A budget keeps repeating monthly only if you budgeted it for this month or later, and otherwise ends with its last month. Money Actual rolled over between months and what it showed as To Budget are not imported.
      </ImportInfoCard>

      {tracksTransfers && (
        <ImportInfoCard title="Payments counted too">
          A budget whose category also carried payments to off-budget accounts, like a loan, tracks both its category and the transfer category those payments take, so it counts them as Actual did.
        </ImportInfoCard>
      )}

      {skippedBudgets.length > 0 && <ActualSkippedBudgetsTable budgets={skippedBudgets} budgetDecimals={budgetDecimals} />}

      {budgetSelectionError && (
        <p role="alert" className="text-sm font-medium" style={{ color: 'var(--app-negative)' }}>
          {budgetSelectionError}
        </p>
      )}

      {budgetDrafts.length === 0 ? (
        <EmptyState title="No budgets detected" description="Nothing in this budget was given an amount above zero." />
      ) : importableDrafts.length === 0 ? (
        <EmptyState title="No importable budgets" description="Every budget is skipped, for the reasons listed above." />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[52rem] table-fixed text-left text-[0.9375rem]">
            <colgroup>
              <col className="w-12" />
              <col className="w-[26%]" />
              <col className="w-[15%]" />
              <col className="w-[16%]" />
              <col className="w-[11%]" />
              <col className="w-[14%]" />
              <col className="w-[14%]" />
            </colgroup>
            <thead style={{ color: 'var(--app-text-subtle)', background: 'var(--app-input-bg)' }}>
              <tr>
                <th className="w-12 px-2 py-2.5 font-medium">
                  <span className="flex justify-center">
                    <Checkbox
                      checked={allChecked}
                      indeterminate={someChecked}
                      disabled={selectionLocked}
                      label={allChecked ? 'Deselect all budgets' : 'Select all budgets'}
                      onChange={() => setBudgetsSelected(importableDrafts.map((draft) => draft.categoryId), !allChecked)}
                    />
                  </span>
                </th>
                <th className="px-4 py-2.5 font-medium">Budget</th>
                <th className="px-4 py-2.5 font-medium">Repeats</th>
                <th className="px-4 py-2.5 text-right font-medium">Latest Amount</th>
                <th className="px-4 py-2.5 text-right font-medium">Months</th>
                <th className="px-4 py-2.5 font-medium">First Month</th>
                <th className="px-4 py-2.5 font-medium">Last Month</th>
              </tr>
            </thead>
            <tbody>
              {importableDrafts.map((draft) => {
                const latest = draft.months.at(-1)

                return (
                  <tr key={draft.categoryId}>
                    <td className="px-2 py-2.5 align-middle">
                      <span className="flex justify-center">
                        <Checkbox
                          checked={isChecked(draft)}
                          disabled={selectionLocked}
                          label={`Import ${draft.name}`}
                          onChange={() => toggleBudgetSelection(draft.categoryId)}
                        />
                      </span>
                    </td>
                    <td className="truncate px-4 py-2.5 align-middle font-medium">
                      <span className="inline-flex max-w-full min-w-0 items-center gap-2">
                        <span className="truncate">{draft.name}</span>
                        {draft.isArchived && (
                          <span
                            className="inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium"
                            style={{
                              background: 'var(--app-surface-soft)',
                              color: 'var(--app-text-muted)',
                              border: '1px solid var(--app-border)',
                            }}
                          >
                            <EyeOff size={11} aria-hidden />
                            Archived
                          </span>
                        )}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 align-middle" style={{ color: 'var(--app-text-muted)' }}>
                      {draft.recurs ? 'Monthly' : 'Not recurring'}
                    </td>
                    <td className="px-4 py-2.5 text-right align-middle font-financial tabular-nums">
                      {latest ? formatScaledAmount(latest.amount, budgetDecimals, budgetDecimals) : ''}
                    </td>
                    <td className="px-4 py-2.5 text-right align-middle font-financial tabular-nums">
                      {draft.months.length}
                    </td>
                    <td className="px-4 py-2.5 align-middle font-financial tabular-nums">{draft.months[0]?.month ?? ''}</td>
                    <td className="px-4 py-2.5 align-middle font-financial tabular-nums">{latest?.month ?? ''}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </ImportStep>
  )
}
