import { useMemo, useRef, useState, type MouseEvent } from 'react'
import type { RunwaySegment } from '@/dashboard/types/dashboard'

/**
 * Tracks hover state for the runway contribution bar.
 * Cursor position is stored as a percentage so the tooltip remains responsive.
 */
export function useRunwayHover(runwaySegments: RunwaySegment[]) {
  const [runwayHoverXPct, setRunwayHoverXPct] = useState<number | null>(null)
  const runwayBarRef = useRef<HTMLDivElement>(null)
  const hoveredSegment = useMemo(
    () => {
      if (runwayHoverXPct === null || runwaySegments.length === 0) return null

      // Segments are rendered as cumulative percentages, so the hovered slice
      // is the first segment whose right edge is past the cursor percentage.
      let cursor = 0
      for (const segment of runwaySegments) {
        cursor += segment.pct
        if (runwayHoverXPct <= cursor) return segment
      }

      return runwaySegments[runwaySegments.length - 1]
    },
    [runwayHoverXPct, runwaySegments],
  )

  function handleRunwayMouseMove(event: MouseEvent<HTMLDivElement>) {
    if (runwaySegments.length === 0) return

    const rect = event.currentTarget.getBoundingClientRect()
    // Store cursor position as a 0-100 percentage so the tooltip can slide
    // smoothly across responsive widths without measuring each segment.
    const xPct = ((event.clientX - rect.left) / rect.width) * 100
    setRunwayHoverXPct(Math.max(0, Math.min(100, xPct)))
  }

  function handleRunwayMouseLeave() {
    setRunwayHoverXPct(null)
  }

  return {
    hoveredSegment,
    runwayBarRef,
    runwayHoverXPct,
    handleRunwayMouseLeave,
    handleRunwayMouseMove,
  }
}
