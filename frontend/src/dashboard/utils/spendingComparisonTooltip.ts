import type { MouseEvent as ReactMouseEvent } from 'react'
import type { ChartTooltipPointer } from '@/components/charts/DeferredChartTooltipOverlay'
import type { SpendingComparisonSeriesPoint } from '@/dashboard/types/dashboard'

export type SpendingComparisonTooltipState = {
  activeLabel?: string | number
  activeTooltipIndex?: string | number | null
  activeCoordinate?: {
    x?: number
  }
  activePayload?: Array<{
    payload?: SpendingComparisonSeriesPoint
  }>
}

export function getSpendingComparisonTooltipKey(point: SpendingComparisonSeriesPoint) {
  return point.label
}

/**
 * Converts Recharts mouse state into the pointer shape used by the deferred tooltip overlay
 */
export function getSpendingComparisonTooltipPointer(
  state: SpendingComparisonTooltipState,
  event: ReactMouseEvent<SVGGraphicsElement>,
): ChartTooltipPointer {
  return {
    clientX: event.clientX,
    clientY: event.clientY,
    chartX: typeof state.activeCoordinate?.x === 'number' ? state.activeCoordinate.x : undefined,
  }
}

/**
 * Resolves the active spending comparison point from Recharts payload, index, or label fallbacks
 */
export function getSpendingComparisonTooltipPoint(
  state: SpendingComparisonTooltipState,
  data: SpendingComparisonSeriesPoint[],
  pointsByLabel: Map<string, SpendingComparisonSeriesPoint>,
) {
  const payloadPoint = state.activePayload?.[0]?.payload
  if (payloadPoint) return payloadPoint

  const activeIndex = Number(state.activeTooltipIndex)
  if (Number.isInteger(activeIndex)) return data[activeIndex]

  return state.activeLabel === undefined
    ? undefined
    : pointsByLabel.get(String(state.activeLabel))
}
