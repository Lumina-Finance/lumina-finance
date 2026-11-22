import { useBaseBudgets } from '@/api/budgets'
import { getExistingBudgetCount } from '@/utils/budgetLimits'

/**
 * Reads how many budgets the person already keeps, for the import budgets step. The count is null while
 * the list has no data. `budgetsFailed` says the list could not be read, `retry` asks for it again, and
 * `isRetrying` says that request is running
 */
export function useExistingBudgetCount() {
  const baseBudgetsQuery = useBaseBudgets()
  return {
    existingBudgetCount: getExistingBudgetCount(baseBudgetsQuery.data),
    budgetsFailed: baseBudgetsQuery.isError,
    isRetrying: baseBudgetsQuery.isError && baseBudgetsQuery.isFetching,
    retry: () => void baseBudgetsQuery.refetch(),
  }
}
