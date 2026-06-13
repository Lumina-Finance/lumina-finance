import type { Budget, BudgetUtilization } from '@/api/budgets'
import { getBudgetUtilizationPercent } from '@/budgets/utils/utilization'

/**
 * Classifies the latest budget period into the status used by cards and details summaries
 */
export function attentionState(latestPeriod: Budget | undefined, utilization: BudgetUtilization | undefined) {
  if (!latestPeriod || !utilization) {
    return {
      label: 'Needs attention',
      background: 'var(--app-negative-soft)',
      color: 'var(--app-negative)',
      textColor: 'var(--app-negative)',
      indicatorColor: 'var(--app-negative)',
    }
  }

  const usedPercent = getBudgetUtilizationPercent(utilization.total_spent, latestPeriod.overall_limit)
  if (usedPercent >= 100) {
    return {
      label: 'Needs attention',
      background: 'var(--app-negative-soft)',
      color: 'var(--app-negative)',
      textColor: 'var(--app-negative)',
      indicatorColor: 'var(--app-negative)',
    }
  }
  if (usedPercent >= 80) {
    return {
      label: 'Watch',
      background: 'var(--app-warning-soft)',
      color: 'var(--app-warning)',
      textColor: 'var(--app-warning-text)',
      indicatorColor: 'var(--app-warning)',
    }
  }
  return {
    label: 'On track',
    background: 'var(--app-positive-soft)',
    color: 'var(--app-positive)',
    textColor: 'var(--app-positive)',
    indicatorColor: 'var(--app-positive)',
  }
}
