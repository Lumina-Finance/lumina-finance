import type { MouseEvent as ReactMouseEvent } from 'react'
import type { ChartTooltipPointer } from '@/components/charts/DeferredChartTooltipOverlay'

export type RechartsTooltipState<TPoint> = {
  activeLabel?: string | number
  activeTooltipIndex?: string | number | null
  activeCoordinate?: {
    x?: number
  }
  activePayload?: Array<{
    payload?: TPoint
  }>
}

type RechartsTooltipPointOptions<TPoint> = {
  state: RechartsTooltipState<TPoint>
  data: TPoint[]
  resolveLabel?: (label: string) => TPoint | undefined
}

/**
 * Converts Recharts mouse state into the pointer shape used by the deferred tooltip overlay
 */
export function getRechartsTooltipPointer<TPoint>(
  state: RechartsTooltipState<TPoint>,
  event: ReactMouseEvent<SVGGraphicsElement>,
): ChartTooltipPointer {
  return {
    clientX: event.clientX,
    clientY: event.clientY,
    chartX: typeof state.activeCoordinate?.x === 'number' ? state.activeCoordinate.x : undefined,
  }
}

/**
 * Resolves the active chart point from Recharts payload, index, or an optional label fallback
 */
export function getRechartsTooltipPoint<TPoint>({
  state,
  data,
  resolveLabel,
}: RechartsTooltipPointOptions<TPoint>) {
  const payloadPoint = state.activePayload?.[0]?.payload
  if (payloadPoint) return payloadPoint

  if (state.activeTooltipIndex !== undefined && state.activeTooltipIndex !== null) {
    const activeIndex = Number(state.activeTooltipIndex)
    if (Number.isInteger(activeIndex)) return data[activeIndex]
  }

  return state.activeLabel === undefined
    ? undefined
    : resolveLabel?.(String(state.activeLabel))
}
