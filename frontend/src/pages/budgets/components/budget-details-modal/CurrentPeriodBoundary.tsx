import {
  usePlotArea,
  useXAxisScale,
  type ScaleFunction,
} from 'recharts'

const CURRENT_PERIOD_BOUNDARY_DASH = '3 3'

/**
 * Draws the dashed boundary marking where the current, still-in-progress period begins, mirroring
 * the savings-rate dashboard chart's current-month divider
 *
 * Defined locally rather than reused from the dashboard because the boundary is wired to this
 * chart's period keys; renders nothing once there is no current period in the visible window
 */
export default function CurrentPeriodBoundary({ currentPeriodKey }: { currentPeriodKey: string | undefined }) {
  const plotArea = usePlotArea()
  const xScale: ScaleFunction | undefined = useXAxisScale()
  if (!currentPeriodKey || !plotArea || !xScale) return null

  const leftEdge = xScale(currentPeriodKey)
  if (typeof leftEdge !== 'number' || !Number.isFinite(leftEdge)) return null

  // The band scale maps a category to its slot's left edge, which is exactly where the current
  // period begins, so that value is used directly as the divider's x position
  return (
    <line
      x1={leftEdge}
      x2={leftEdge}
      y1={plotArea.y}
      y2={plotArea.y + plotArea.height}
      stroke="var(--app-text-subtle)"
      strokeDasharray={CURRENT_PERIOD_BOUNDARY_DASH}
      strokeWidth={1}
    />
  )
}
