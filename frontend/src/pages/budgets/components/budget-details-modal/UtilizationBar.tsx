import { Rectangle } from 'recharts'

// Rounds only the top corners of a utilization bar
const BUDGET_BAR_TOP_CORNER_RADIUS: [number, number, number, number] = [4, 4, 0, 0]

/**
 * Rounds a rectangle's edges to whole pixels rather than rounding its origin and size
 * independently, so the resulting `x`/`y`/`width`/`height` describe the same whole-pixel left,
 * top, right, and bottom edges
 *
 * Stacked bar segments each render as a separate SVG path, and two adjacent segments share their
 * boundary coordinate as the same fractional value. Rounding that shared edge here gives both
 * paths the identical integer pixel row, which removes the anti-aliasing seam and the hairline
 * horizontal offset that fractional coordinates otherwise cause on non-retina displays
 */
function getPixelSnappedRect(x: number, y: number, width: number, height: number) {
  const left = Math.round(x)
  const top = Math.round(y)
  const right = Math.round(x + width)
  const bottom = Math.round(y + height)

  return { x: left, y: top, width: right - left, height: bottom - top }
}

type BudgetUtilizationBarProps = {
  fill?: string
  roundTop: boolean
  x?: number
  y?: number
  width?: number
  height?: number
}

/**
 * Draws one utilization bar or stacked segment as a single pixel-snapped rectangle, with a rounded
 * top only when it is the topmost element in its column
 *
 * Each segment renders as its own SVG path, and two adjacent segments share their boundary
 * coordinate as the same fractional value. Snapping the rectangle's edges to whole pixels gives
 * neighbouring segments the identical integer pixel row, which removes the anti-aliasing seam and
 * the hairline horizontal offset that fractional coordinates otherwise cause on non-retina displays
 */
export default function BudgetUtilizationBar({ fill, roundTop, x, y, width, height }: BudgetUtilizationBarProps) {
  const hasNumericGeometry =
    typeof x === 'number' && typeof y === 'number' && typeof width === 'number' && typeof height === 'number'
  const rect = hasNumericGeometry ? getPixelSnappedRect(x, y, width, height) : { x, y, width, height }

  return (
    <Rectangle
      x={rect.x}
      y={rect.y}
      width={rect.width}
      height={rect.height}
      fill={fill}
      radius={roundTop ? BUDGET_BAR_TOP_CORNER_RADIUS : 0}
    />
  )
}
