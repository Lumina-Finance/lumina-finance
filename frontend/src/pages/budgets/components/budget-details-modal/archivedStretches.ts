import type { BudgetChartPoint } from '@/pages/budgets/components/budget-details-modal/ChartTooltip'

export type ArchivedChartStretch = {
  firstKey: string
  lastKey: string
}

/**
 * Groups consecutive archived chart columns into contiguous stretches so a multi-step gap renders
 * as one spanning shaded band instead of one band per column
 */
export function getArchivedChartStretches(chartData: BudgetChartPoint[]): ArchivedChartStretch[] {
  const stretches: ArchivedChartStretch[] = []
  let runStart: string | null = null
  let runEnd: string | null = null

  chartData.forEach((point) => {
    if (point.archived) {
      if (runStart === null) runStart = point.periodKey
      runEnd = point.periodKey
      return
    }

    if (runStart !== null && runEnd !== null) stretches.push({ firstKey: runStart, lastKey: runEnd })
    runStart = null
    runEnd = null
  })

  if (runStart !== null && runEnd !== null) stretches.push({ firstKey: runStart, lastKey: runEnd })

  return stretches
}
