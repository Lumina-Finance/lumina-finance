import {
  usePlotArea,
  useXAxisScale,
} from 'recharts'

/**
 * Draws the boundary before the current month in the savings-rate bar chart
 * Uses Recharts geometry hooks so the line stays aligned inside responsive charts
 */
export function SavingsCurrentBoundary({ currentLabel }: { currentLabel: string }) {

  // Recharts v3 exposes plot geometry through hooks, so drawing the marker here
  // keeps the current-month boundary aligned after responsive chart resizing
  const plotArea = usePlotArea()
  const xScale = useXAxisScale() as ((label: string) => number)
  if (!plotArea || !xScale) return null

  const slotLeft = xScale(currentLabel)
  if (typeof slotLeft !== 'number' || !Number.isFinite(slotLeft)) return null

  // The band scale maps a category to its slot's left edge, which is exactly
  // where the current month begins
  return (
    <line
      x1={slotLeft}
      x2={slotLeft}
      y1={plotArea.y}
      y2={plotArea.y + plotArea.height}
      stroke="var(--app-text-subtle)"
      strokeDasharray="3 3"
      strokeWidth={1}
    />
  )
}
