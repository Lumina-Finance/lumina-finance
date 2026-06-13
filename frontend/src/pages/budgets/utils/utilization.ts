/**
 * Calculates budget utilization percent while treating zero or negative limits as unused
 */
export function getBudgetUtilizationPercent(spent: number, limit: number) {
  if (limit <= 0) return 0
  return (spent / limit) * 100
}
