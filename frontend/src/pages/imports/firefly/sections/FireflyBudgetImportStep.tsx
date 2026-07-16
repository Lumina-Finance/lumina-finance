import { EmptyState, ImportCheckbox, ImportInfoCard, ImportStep } from '../../components'
import { FireflySkippedBudgetsTable } from '../components'
import type { FireflyImportWorkflow } from '../hooks'

type FireflyBudgetImportStepProps = Pick<
  FireflyImportWorkflow,
  | 'importResult'
  | 'budgetsFile'
  | 'budgetDrafts'
  | 'selectedBudgetNames'
  | 'toggleBudgetSelection'
  | 'budgetImportStatuses'
  | 'budgetImportErrors'
  | 'budgetStageError'
  | 'isImportingBudgets'
  | 'handleRetryBudgetImport'
>

/**
 * Previews the budgets the commit will import and lets the user choose them
 *
 * Budgets the export cannot back move into their own skipped panel beneath
 * the selection table, in the same shape as the skipped transaction rows. The
 * commit imports the selected budgets itself, so this step only offers a
 * button when the budget stage failed after the transactions were committed
 */
export function FireflyBudgetImportStep({
  importResult,
  budgetsFile,
  budgetDrafts,
  selectedBudgetNames,
  toggleBudgetSelection,
  budgetImportStatuses,
  budgetImportErrors,
  budgetStageError,
  isImportingBudgets,
  handleRetryBudgetImport,
}: FireflyBudgetImportStepProps) {
  if (!budgetsFile) return null

  const importableDrafts = budgetDrafts.filter((draft) => !draft.disabledReason)
  const skippedDrafts = budgetDrafts.filter((draft) => draft.disabledReason)

  const retryable = Boolean(importResult) && Boolean(budgetStageError)
  const pendingCount = importableDrafts.filter((draft) => (
    selectedBudgetNames.has(draft.name)
    && budgetImportStatuses[draft.name] !== 'imported'
  )).length

  // Selection drives what the commit imports, so it locks once the commit has
  // run unless the budget stage failed and is waiting on a retry
  const selectionLocked = isImportingBudgets || (Boolean(importResult) && !retryable)

  return (
    <ImportStep
      index="04"
      title="Budget Import"
      description="Budgets derived from the budgets export and the staged transactions, imported together with them."
    >
      <ImportInfoCard title="Periods As Exported">
        Each budget keeps its limit periods exactly as exported, with their original dates and amounts, and continues on the cadence of its most recent period.
      </ImportInfoCard>

      {skippedDrafts.length > 0 && <FireflySkippedBudgetsTable drafts={skippedDrafts} />}

      {budgetDrafts.length === 0 ? (
        <EmptyState
          title="No budgets detected"
          description="The budgets CSV has no budget limit rows."
        />
      ) : importableDrafts.length === 0 ? (
        <EmptyState
          title="No importable budgets"
          description="Every budget in the export is skipped, for the reasons listed below."
        />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[58rem] table-fixed text-left text-[0.9375rem]">
            <colgroup>
              <col className="w-12" />
              <col className="w-[17%]" />
              <col className="w-[11%]" />
              <col className="w-[13%]" />
              <col className="w-[24%]" />
              <col className="w-[12%]" />
              <col className="w-[19%]" />
            </colgroup>
            <thead style={{ color: 'var(--app-text-subtle)', background: 'var(--app-input-bg)' }}>
              <tr>
                <th className="w-12 px-4 py-2.5 font-medium" aria-label="Import selection" />
                <th className="px-4 py-2.5 font-medium">Budget</th>
                <th className="px-4 py-2.5 font-medium">Repeats</th>
                <th className="px-4 py-2.5 text-right font-medium">Latest Amount</th>
                <th className="px-4 py-2.5 font-medium">Categories</th>
                <th className="px-4 py-2.5 font-medium">First Period</th>
                <th className="px-4 py-2.5 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {importableDrafts.map((draft) => {
                const status = budgetImportStatuses[draft.name]
                const selectable = status !== 'imported' && !selectionLocked

                // A schedule with more than one distinct amount means the
                // limit changed over time, so the row flags that history
                // beneath the latest amount
                const distinctAmountCount = new Set(draft.limits.map((limit) => limit.amount)).size

                return (
                  <tr key={draft.name}>
                    <td className="px-4 py-2.5 align-middle">
                      <ImportCheckbox
                        checked={status !== 'imported' && selectedBudgetNames.has(draft.name)}
                        disabled={!selectable}
                        label={`Import ${draft.name}`}
                        onChange={() => toggleBudgetSelection(draft.name)}
                      />
                    </td>
                    <td className="truncate px-4 py-2.5 align-middle font-medium">{draft.name}</td>
                    <td className="px-4 py-2.5 align-middle" style={{ color: 'var(--app-text-muted)' }}>
                      {draft.periodLabel ?? ''}
                    </td>
                    <td className="px-4 py-2.5 text-right align-middle font-financial tabular-nums">
                      {draft.amount ? `${draft.amount} ${draft.currencyCode}` : ''}
                      {distinctAmountCount > 1 && (
                        <div className="text-xs" style={{ color: 'var(--app-text-subtle)' }}>
                          {distinctAmountCount} changes over time
                        </div>
                      )}
                    </td>
                    <td className="truncate px-4 py-2.5 align-middle" style={{ color: 'var(--app-text-muted)' }}>
                      {draft.categoryNames.join(', ')}
                    </td>
                    <td className="px-4 py-2.5 align-middle font-financial tabular-nums">
                      {draft.firstPeriodStart ?? ''}
                    </td>
                    <td className="px-4 py-2.5 align-middle text-sm">
                      <BudgetRowStatus
                        status={status}
                        error={budgetImportErrors[draft.name]}
                      />
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {retryable && (
        <div className="flex flex-col items-end gap-3 pt-2">
          <p role="alert" className="max-w-xl text-right text-sm font-medium" style={{ color: 'var(--app-negative)' }}>
            Your transactions were imported. Only the budgets failed, so retrying imports the budgets alone and leaves the transactions untouched.
          </p>
          <button
            type="button"
            className="app-primary-button"
            onClick={handleRetryBudgetImport}
            disabled={pendingCount === 0 || isImportingBudgets}
          >
            {isImportingBudgets ? 'Importing budgets' : 'Retry budget import'}
          </button>
        </div>
      )}
    </ImportStep>
  )
}

/**
 * Renders the hint, success, or error state for one budget row
 */
function BudgetRowStatus({
  status,
  error,
}: {
  status: 'imported' | 'error' | undefined
  error: string | undefined
}) {
  if (status === 'imported') {
    return <span className="font-medium" style={{ color: 'var(--app-positive)' }}>Imported</span>
  }
  if (status === 'error') {
    return <span role="alert" style={{ color: 'var(--app-negative)' }}>{error ?? 'Budget import failed.'}</span>
  }
  return <span style={{ color: 'var(--app-text-subtle)' }}>Ready to import</span>
}
