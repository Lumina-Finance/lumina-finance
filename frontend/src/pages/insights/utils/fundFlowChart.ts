const MIN_CHART_HEIGHT = 450
const SANKEY_ROW_HEIGHT = 56
const SANKEY_VERTICAL_CHROME = 112

/**
 * Sizes the Sankey chart so the larger side has enough vertical row space
 */
export function getFundFlowChartHeight(incomeSourceCount: number, expenseCategoryCount: number) {
  return Math.max(
    MIN_CHART_HEIGHT,
    Math.max(incomeSourceCount, expenseCategoryCount) * SANKEY_ROW_HEIGHT + SANKEY_VERTICAL_CHROME,
  )
}
