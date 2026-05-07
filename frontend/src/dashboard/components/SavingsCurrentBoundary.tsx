import {
  usePlotArea,
  useXAxisScale,
} from 'recharts'

/**
 * Draws the boundary before the current month in the savings-rate bar chart.
 * Uses Recharts geometry hooks so the line stays aligned inside responsive charts.
 */
export function SavingsCurrentBoundary({ currentLabel }: { currentLabel: string }) {
  // Recharts v3 exposes plot geometry through hooks; drawing the marker here
  // keeps the current-month boundary aligned after responsive chart resizing.
  const plotArea = usePlotArea()
  const xScale = useXAxisScale() as ((label: string) => number) & { bandwidth?: () => number }
  if (!plotArea || !xScale) return null

  const center = xScale(currentLabel)
  if (typeof center !== 'number' || !Number.isFinite(center)) return null

  const bandwidth = xScale.bandwidth ? xScale.bandwidth() : 0
  // Category scales can report the band center; use the left edge so the
  // divider marks where the current period begins, not the middle of the bar.
  const leftEdge = center - bandwidth / 2

  return (
    <line
      x1={leftEdge}
      x2={leftEdge}
      y1={plotArea.y}
      y2={plotArea.y + plotArea.height}
      stroke="var(--app-text-subtle)"
      strokeDasharray="3 3"
      strokeWidth={1}
    />
  )
}
