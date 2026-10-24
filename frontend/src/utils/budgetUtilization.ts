import { getRoundedPercent } from '@/utils/rounding'

/**
 * Calculates budget utilization percent while treating zero or negative limits as unused
 */
export function getBudgetUtilizationPercent(spent: number, limit: number) {
  if (limit <= 0) return 0
  return (spent / limit) * 100
}

/**
 * Returns the whole percent of a budget spent for a written label, rounded up so a budget never reads
 * as less used than it is. The exact percent above still drives a bar and a status
 */
export function getBudgetUtilizationLabelPercent(spent: number, limit: number) {
  if (limit <= 0) return 0
  return getRoundedPercent(spent, limit, 'up')
}
