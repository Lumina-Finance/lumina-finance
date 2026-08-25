import type { Budget, BudgetUtilization } from '@/api/budgets'
import { getBudgetUtilizationPercent } from '@/pages/budgets/utils/utilization'
import { getValueMarkColor } from '@/utils/valueMarkColor'

/**
 * Classifies the latest budget period into the status used by cards and details summaries
 *
 * The badge text and the shapes beside it take different colours: text keeps the contrast a
 * reader needs, while the strip and the bar match every other shape drawn from a value
 */
export function attentionState(latestPeriod: Budget | undefined, utilization: BudgetUtilization | undefined) {
  if (!latestPeriod) {
    return {
      label: 'Needs attention',
      background: 'var(--app-negative-soft)',
      textColor: 'var(--app-negative)',
      indicatorColor: getValueMarkColor('negative'),
    }
  }

  const usedPercent = getBudgetUtilizationPercent(utilization?.total_spent ?? 0, latestPeriod.overall_limit)
  if (usedPercent >= 100) {
    return {
      label: 'Needs attention',
      background: 'var(--app-negative-soft)',
      textColor: 'var(--app-negative)',
      indicatorColor: getValueMarkColor('negative'),
    }
  }
  if (usedPercent >= 80) {
    return {
      label: 'Watch',
      background: 'var(--app-warning-soft)',
      textColor: 'var(--app-warning-text)',
      indicatorColor: 'var(--app-warning)',
    }
  }
  return {
    label: 'On track',
    background: 'var(--app-positive-soft)',
    textColor: 'var(--app-positive)',
    indicatorColor: getValueMarkColor('positive'),
  }
}
