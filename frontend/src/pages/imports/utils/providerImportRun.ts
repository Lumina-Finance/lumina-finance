import type { ImportRunBudgets, JournalImportRunResponse } from '@/api/provider-imports'
import { MAX_BASE_BUDGETS, MAX_BUDGET_CATEGORIES } from '@/utils/budgetLimits'
import { joinImportSummaryParts } from '@/pages/imports/utils/common'

/** What the overlay calls the upload of an export from another app */
export const PROVIDER_IMPORT_UPLOAD_LABEL = 'Uploading the export'

/**
 * Builds the budgets a provider import creates alongside its rows, or the reason it can't
 */
export function buildProviderRunBudgets(build: () => ImportRunBudgets): {
  budgets: ImportRunBudgets | null
  error: string | null
} {
  try {
    return { budgets: build(), error: null }
  } catch (error) {
    return { budgets: null, error: error instanceof Error ? error.message : String(error) }
  }
}

/** Where the count of the person's budgets stands while a selection waits on it, or null once it is known */
export type BudgetCountCheck = 'checking' | 'failed' | null

const BUDGET_COUNT_CHECK_MESSAGES = {
  checking: 'Checking how many budgets you already have.',
  failed:
    "Your budgets couldn't be loaded, so the selected budgets can't be checked. Please try again, or unselect them to import the rest.",
} as const

/**
 * Whether a selection is waiting on the count of budgets the person already keeps. An empty selection
 * waits on nothing
 */
export function getBudgetCountCheck(
  existingBudgetCount: number | null,
  budgetsFailed: boolean,
  selectedCount: number,
): BudgetCountCheck {
  if (existingBudgetCount !== null || selectedCount === 0) return null
  return budgetsFailed ? 'failed' : 'checking'
}

/**
 * Why the selected budgets can't be imported, if they can't. A person keeps a bounded number of budgets
 * and a budget tracks a bounded number of categories, and the importer's refusal would name none of the
 * budgets
 *
 * @param selected - The budgets chosen for import, with the categories each tracks
 * @param existingBudgetCount - Budgets the person already keeps, or null while the list has no data
 * @param budgetsFailed - Whether the list of budgets failed to load
 * @param buildError - Why the run's budgets can't be built, if they can't
 */
export function getProviderBudgetSelectionError(
  selected: readonly { name: string; categoryCount: number }[],
  existingBudgetCount: number | null,
  budgetsFailed: boolean,
  buildError: string | null,
) {
  // With no count, a full import could upload before the commit refuses it
  const check = getBudgetCountCheck(existingBudgetCount, budgetsFailed, selected.length)
  if (check) return BUDGET_COUNT_CHECK_MESSAGES[check]

  const existing = existingBudgetCount ?? 0
  const remaining = Math.max(0, MAX_BASE_BUDGETS - existing)
  if (selected.length > remaining) {
    return remaining === 0
      ? `You can keep up to ${MAX_BASE_BUDGETS} budgets and already have ${existing}, so none can be imported. Please unselect them to import the rest.`
      : `Please select at most ${remaining} budget${remaining === 1 ? '' : 's'} to import, since you can keep up to ${MAX_BASE_BUDGETS} and already have ${existing}.`
  }

  const overLimit = selected.find((budget) => budget.categoryCount > MAX_BUDGET_CATEGORIES)
  if (overLimit) {
    return `${overLimit.name} tracks ${overLimit.categoryCount} categories, and a budget can track up to ${MAX_BUDGET_CATEGORIES}. Please unselect it to import the rest.`
  }
  return buildError
}

/**
 * Formats the import result into the overlay summary line
 *
 * Budgets and archived accounts only join the line when the commit wrote some, so an import
 * without them reads as a transactions import alone
 *
 * @param result - What the commit wrote
 * @param skippedCount - Rows the browser left out because they cannot be written
 */
export function formatProviderImportSummary(result: JournalImportRunResponse, skippedCount: number) {
  const parts = [
    `${result.rows_imported} row${result.rows_imported === 1 ? '' : 's'} imported`,
    `${result.transactions_created} transaction${result.transactions_created === 1 ? '' : 's'} created`,
    `${skippedCount} skipped`,
  ]
  if (result.budgets_created > 0) {
    parts.push(`${result.budgets_created} budget${result.budgets_created === 1 ? '' : 's'} imported`)
  }
  if (result.accounts_archived > 0) {
    parts.push(`${result.accounts_archived} account${result.accounts_archived === 1 ? '' : 's'} archived`)
  }

  return joinImportSummaryParts(parts)
}
