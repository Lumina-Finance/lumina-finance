import type {
  BreakdownEntry,
  BreakdownMode,
  CategoryTrendSection,
} from '@/insights/types/incomeExpenseBreakdown'
import { formatCurrency } from '@/utils/formatCurrency'

const PIE_LEGEND_LIMIT = 5
const PIE_LEGEND_ROW_HEIGHT = 20
const PIE_LEGEND_ROW_GAP = 8
const PIE_LEGEND_MIN_HEIGHT = 136

export type BreakdownCrossoverKind = 'income-loss' | 'expense-refund'

export function getBreakdownTotal(entries: BreakdownEntry[]) {
  return entries.reduce((sum, entry) => sum + entry.amount, 0)
}

/**
 * Returns a whole-number slice percentage while treating empty totals as zero
 */
export function getBreakdownPercent(amount: number, total: number) {
  if (total <= 0) return 0
  return Math.round((amount / total) * 100)
}

/**
 * Formats signed currency changes without showing a sign for unchanged values
 */
export function formatSignedBreakdownCurrency(amount: number, currency: string) {
  if (amount === 0) return formatCurrency(amount, currency)
  return `${amount > 0 ? '+' : '-'}${formatCurrency(Math.abs(amount), currency)}`
}

/**
 * Colours driver changes according to whether higher values are good for the active mode
 */
export function getCategoryDriverColor(mode: BreakdownMode, changeAmount: number) {
  if (changeAmount === 0) return 'var(--app-text-muted)'
  if (mode === 'income') return changeAmount > 0 ? 'var(--app-chart-positive)' : 'var(--app-chart-negative)'
  return changeAmount > 0 ? 'var(--app-chart-negative)' : 'var(--app-chart-positive)'
}

/**
 * Describes the direction of a category driver amount change
 */
export function getCategoryDriverDescriptor(changeAmount: number) {
  if (changeAmount === 0) return 'flat'
  return changeAmount > 0 ? 'increase' : 'decrease'
}

export function getTransactionCountLabel(count: number) {
  return `${count} ${count === 1 ? 'transaction' : 'transactions'}`
}

/**
 * Identifies categories that crossed from the opposite side after netting
 */
export function getBreakdownCrossoverKind(
  entry: BreakdownEntry,
  mode: BreakdownMode,
): BreakdownCrossoverKind | null {
  if (mode === 'expense' && entry.categoryKind === 'income') return 'income-loss'
  if (mode === 'income' && entry.categoryKind === 'expense') return 'expense-refund'
  return null
}

/**
 * Describes the netting rules behind the active breakdown mode
 */
export function getBreakdownCalculation(mode: BreakdownMode) {
  return mode === 'expense'
    ? 'Spending by category for this range. Refunds reduce spending first before flipping into income. Transfers are excluded'
    : 'Income by category for this range. Reversals reduce income first before flipping into spending. Transfers are excluded'
}

/**
 * Describes how each trend section is ordered against the comparison period
 */
export function getTrendSectionCalculation(sectionId: CategoryTrendSection['id']) {
  return sectionId === 'increases'
    ? 'Compared with the previous matching period, sorted by biggest increase'
    : 'Compared with the previous matching period, sorted by biggest decrease'
}

/**
 * Keeps flipped categories visible even when they fall outside the top legend entries
 */
export function getBreakdownLegendEntries(entries: BreakdownEntry[], mode: BreakdownMode) {
  const visibleEntries = entries.slice(0, PIE_LEGEND_LIMIT)
  const visibleIds = new Set(visibleEntries.map((entry) => entry.id))
  const hiddenFlippedEntries = entries
    .slice(PIE_LEGEND_LIMIT)
    .filter((entry) => getBreakdownCrossoverKind(entry, mode) && !visibleIds.has(entry.id))

  return [...visibleEntries, ...hiddenFlippedEntries]
}

/**
 * Reserves enough legend height so animated rows do not collapse the chart layout
 */
export function getBreakdownLegendMinHeight(entryCount: number) {
  if (entryCount <= 0) return PIE_LEGEND_MIN_HEIGHT

  return Math.max(
    PIE_LEGEND_MIN_HEIGHT,
    entryCount * PIE_LEGEND_ROW_HEIGHT + (entryCount - 1) * PIE_LEGEND_ROW_GAP + 4,
  )
}
