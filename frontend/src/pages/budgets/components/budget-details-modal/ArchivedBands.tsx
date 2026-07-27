import {
  usePlotArea,
  useXAxisScale,
  type ScaleFunction,
} from 'recharts'
import type { ArchivedChartStretch } from '@/pages/budgets/components/budget-details-modal/archivedStretches'

const ARCHIVED_BAND_LABEL = 'ARCHIVED'
const ARCHIVED_BAND_INSET_PX = 10
const ARCHIVED_BAND_MIN_WIDTH_PX = 18
const ARCHIVED_BAND_LABEL_MIN_WIDTH_PX = 52
const ARCHIVED_BAND_LABEL_FONT_SIZE = 10
const ARCHIVED_BAND_FILL_OPACITY = 0.12
const ARCHIVED_BAND_CORNER_RADIUS_PX = 6

/**
 * Shades every contiguous archived stretch across the full plot height with one spanning band and
 * a single centred label
 *
 * Recharts exposes plot geometry through hooks, so the band is derived from the categorical scale
 * directly instead of measured DOM coordinates, keeping it aligned inside responsive charts. The
 * hook only exposes the scale's map function, not its bandwidth, so the last slot's right edge
 * comes from calling the map with the 'end' position option rather than a bandwidth lookup. The
 * band spans from the first slot's left edge to the last slot's right edge
 */
export default function ArchivedBandsLayer({ stretches }: { stretches: ArchivedChartStretch[] }) {
  const plotArea = usePlotArea()
  const xScale: ScaleFunction | undefined = useXAxisScale()
  if (!plotArea || !xScale || stretches.length === 0) return null

  return (
    <g>
      {stretches.map((stretch) => {
        const firstSlotLeftEdge = xScale(stretch.firstKey)
        const lastSlotRightEdge = xScale(stretch.lastKey, { position: 'end' })
        if (
          typeof firstSlotLeftEdge !== 'number' ||
          typeof lastSlotRightEdge !== 'number' ||
          !Number.isFinite(firstSlotLeftEdge) ||
          !Number.isFinite(lastSlotRightEdge)
        ) {
          return null
        }

        const leftEdge = firstSlotLeftEdge + ARCHIVED_BAND_INSET_PX / 2
        const rightEdge = lastSlotRightEdge - ARCHIVED_BAND_INSET_PX / 2
        const shadeWidth = Math.max(rightEdge - leftEdge, ARCHIVED_BAND_MIN_WIDTH_PX)
        const shadeCenter = (leftEdge + rightEdge) / 2

        return (
          <g key={`${stretch.firstKey}-${stretch.lastKey}`}>
            <rect
              x={shadeCenter - shadeWidth / 2}
              y={plotArea.y}
              width={shadeWidth}
              height={plotArea.height}
              rx={ARCHIVED_BAND_CORNER_RADIUS_PX}
              fill="var(--app-text-muted)"
              fillOpacity={ARCHIVED_BAND_FILL_OPACITY}
            />
            {shadeWidth >= ARCHIVED_BAND_LABEL_MIN_WIDTH_PX && (
              <text
                x={shadeCenter}
                y={plotArea.y + plotArea.height / 2}
                textAnchor="middle"
                dominantBaseline="middle"
                fill="var(--app-text-subtle)"
                fontSize={ARCHIVED_BAND_LABEL_FONT_SIZE}
                fontWeight={600}
                letterSpacing={1.5}
              >
                {ARCHIVED_BAND_LABEL}
              </text>
            )}
          </g>
        )
      })}
    </g>
  )
}
