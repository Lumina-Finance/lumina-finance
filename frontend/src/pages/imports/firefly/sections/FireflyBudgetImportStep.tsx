import { EmptyState, ImportCheckbox, ImportInfoCard, ImportStep } from '../../components'
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
  | 'isImportingBudgets'
  | 'handleImportBudgets'
>

export function FireflyBudgetImportStep({
  importResult,
  budgetsFile,
  budgetDrafts,
  selectedBudgetNames,
  toggleBudgetSelection,
  budgetImportStatuses,
  budgetImportErrors,
  isImportingBudgets,
  handleImportBudgets,
}: FireflyBudgetImportStepProps) {
  if (!importResult || !budgetsFile) return null

  const pendingCount = budgetDrafts.filter((draft) => (
    !draft.disabledReason
    && selectedBudgetNames.has(draft.name)
    && budgetImportStatuses[draft.name] !== 'imported'
  )).length

  return (
    <ImportStep
      index="06"
      title="Budget Import"
      description="Monthly budgets derived from the budgets export and the imported transactions."
    >
      <ImportInfoCard title="Backdated Periods">
        Each budget is created as a monthly budget and every period from its backdate start through today is filled in automatically.
      </ImportInfoCard>

      {budgetDrafts.length === 0 ? (
        <EmptyState
          title="No budgets detected"
          description="The budgets CSV has no budget limit rows."
        />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[58rem] table-fixed text-left text-[0.9375rem]">
            <colgroup>
              <col className="w-12" />
              <col className="w-[18%]" />
              <col className="w-[14%]" />
              <col className="w-[28%]" />
              <col className="w-[12%]" />
              <col className="w-[24%]" />
            </colgroup>
            <thead style={{ color: 'var(--app-text-subtle)', background: 'var(--app-input-bg)' }}>
              <tr>
                <th className="w-12 px-4 py-2.5 font-medium" aria-label="Import selection" />
                <th className="px-4 py-2.5 font-medium">Budget</th>
                <th className="px-4 py-2.5 text-right font-medium">Monthly Amount</th>
                <th className="px-4 py-2.5 font-medium">Categories</th>
                <th className="px-4 py-2.5 font-medium">Backdate Start</th>
                <th className="px-4 py-2.5 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {budgetDrafts.map((draft) => {
                const status = budgetImportStatuses[draft.name]
                const selectable = !draft.disabledReason && status !== 'imported' && !isImportingBudgets

                return (
                  <tr key={draft.name} style={draft.disabledReason ? { color: 'var(--app-text-subtle)' } : undefined}>
                    <td className="px-4 py-2.5 align-middle">
                      <ImportCheckbox
                        checked={!draft.disabledReason && status !== 'imported' && selectedBudgetNames.has(draft.name)}
                        disabled={!selectable}
                        label={`Import ${draft.name}`}
                        onChange={() => toggleBudgetSelection(draft.name)}
                      />
                    </td>
                    <td className="truncate px-4 py-2.5 align-middle font-medium">{draft.name}</td>
                    <td className="px-4 py-2.5 text-right align-middle font-financial tabular-nums">
                      {draft.amount ? `${draft.amount} ${draft.currencyCode}` : ''}
                    </td>
                    <td className="truncate px-4 py-2.5 align-middle" style={{ color: 'var(--app-text-muted)' }}>
                      {draft.categoryNames.join(', ')}
                    </td>
                    <td className="px-4 py-2.5 align-middle font-financial tabular-nums">
                      {draft.periodStart ?? ''}
                    </td>
                    <td className="px-4 py-2.5 align-middle text-sm">
                      <BudgetRowStatus
                        disabledReason={draft.disabledReason}
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

      <div className="flex justify-end pt-2">
        <button
          type="button"
          className="app-primary-button"
          onClick={handleImportBudgets}
          disabled={pendingCount === 0 || isImportingBudgets}
        >
          {isImportingBudgets ? 'Importing budgets' : 'Import budgets'}
        </button>
      </div>
    </ImportStep>
  )
}

/**
 * Renders the hint, success, or error state for one budget row
 */
function BudgetRowStatus({
  disabledReason,
  status,
  error,
}: {
  disabledReason: string | null
  status: 'imported' | 'error' | undefined
  error: string | undefined
}) {
  if (disabledReason) {
    return <span style={{ color: 'var(--app-text-subtle)' }}>{disabledReason}</span>
  }
  if (status === 'imported') {
    return <span className="font-medium" style={{ color: 'var(--app-positive)' }}>Imported</span>
  }
  if (status === 'error') {
    return <span role="alert" style={{ color: 'var(--app-negative)' }}>{error ?? 'Budget import failed.'}</span>
  }
  return <span style={{ color: 'var(--app-text-subtle)' }}>Ready to import</span>
}
