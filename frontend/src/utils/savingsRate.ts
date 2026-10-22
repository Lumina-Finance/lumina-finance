import { getRoundedPercent } from '@/utils/rounding'

/**
 * Returns the share of income left after expenses as a whole percent, or null when there was no
 * income to measure against
 *
 * It rounds down, so 14.5% and 14.9% both read 14% and -14.5% reads -15%, and works from whole minor
 * units rather than a floating-point ratio, so 2,000.00 of income and 1,710.00 of expenses is exactly
 * 14.5% instead of 14.499…%. Spending more than was earned gives a negative rate rather than zero, so
 * an overspent period stays visible
 */
export function getSavingsRate(income: number, expenses: number): number | null {
  if (income <= 0) return null
  return getRoundedPercent(income - expenses, income, 'down')
}
