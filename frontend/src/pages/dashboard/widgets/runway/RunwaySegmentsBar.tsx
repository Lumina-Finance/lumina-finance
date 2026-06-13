import {
  type MouseEvent as ReactMouseEvent,
  type RefObject,
} from 'react'
import {
  ChartTooltipTitle,
  ChartTooltipValue,
} from '@/components/charts/ChartTooltipContent'
import CursorTooltipPortal from '@/components/charts/CursorTooltipPortal'
import type { RunwaySegment } from '@/pages/dashboard/types/dashboard'
import { useCursorTooltip } from '@/hooks/useCursorTooltip'
import { formatCurrency } from '@/utils/formatCurrency'

type RunwaySegmentsBarProps = {
  segments: RunwaySegment[]
  caption: string
  displayCurrency: string
  tooltipOriginRef: RefObject<HTMLDivElement | null>
}

/**
 * Resolves the segment under the cursor based on cumulative percentage width
 */
function getRunwaySegmentAtX(runwaySegments: RunwaySegment[], xPct: number) {
  if (runwaySegments.length === 0) return undefined

  let cursor = 0
  for (const segment of runwaySegments) {
    cursor += segment.pct
    if (xPct <= cursor) return segment
  }

  return runwaySegments[runwaySegments.length - 1]
}

/**
 * Renders the runway account contribution bar and owns its segment tooltip state
 */
export function RunwaySegmentsBar({
  segments,
  caption,
  displayCurrency,
  tooltipOriginRef,
}: RunwaySegmentsBarProps) {
  const {
    tooltipRef,
    tooltipItem: hoveredSegment,
    tooltipVisible,
    showTooltip: showSegmentTooltip,
    hideTooltip,
    handleTooltipTransitionEnd,
  } = useCursorTooltip<RunwaySegment, HTMLDivElement>({
    originRef: tooltipOriginRef,
    xProperty: '--runway-tooltip-x',
    yProperty: '--runway-tooltip-y',
    getItemKey: (segment) => segment.id,
  })

  /**
   * Shows the account segment under the cursor and keeps the tooltip pinned to the latest pointer
   */
  function showTooltip(event: ReactMouseEvent<HTMLDivElement>) {
    if (segments.length === 0) {
      hideTooltip()
      return
    }

    const rect = event.currentTarget.getBoundingClientRect()
    const xPct = Math.max(0, Math.min(100, ((event.clientX - rect.left) / rect.width) * 100))
    const segment = getRunwaySegmentAtX(segments, xPct)
    if (!segment) {
      hideTooltip()
      return
    }

    showSegmentTooltip(segment, event)
  }

  return (
    <>
      <div className="flex min-h-0 flex-1 items-center">
        <div className="relative h-12 w-full">
          <div
            className="flex h-full gap-0.5 overflow-hidden rounded-xl"
            onMouseEnter={showTooltip}
            onMouseMove={showTooltip}
            onMouseLeave={hideTooltip}
          >
            {segments.length > 0 ? (
              segments.map((segment) => (
                <div
                  key={segment.id}
                  style={{ width: `${segment.pct}%`, background: segment.color }}
                />
              ))
            ) : (
              <div
                className="flex flex-1 items-center justify-center text-sm italic max-[1000px]:text-[0.7875rem]"
                style={{
                  background: 'var(--app-border)',
                  color: 'var(--app-text-subtle)',
                }}
              >
                {caption}
              </div>
            )}
          </div>
        </div>
      </div>
      {segments.length > 0 && (
        <p className="text-sm max-[1000px]:text-[0.7875rem]" style={{ color: 'var(--app-text-muted)' }}>
          {caption}
        </p>
      )}
      <CursorTooltipPortal
        ref={tooltipRef}
        className="w-[11rem]"
        onTransitionEnd={handleTooltipTransitionEnd}
        style={{
          opacity: tooltipVisible ? 1 : 0,
          transform: 'translate3d(var(--runway-tooltip-x, 0px), var(--runway-tooltip-y, 0px), 0)',
        }}
      >
        {hoveredSegment && (
          <>
            <ChartTooltipTitle className="truncate font-medium">
              {hoveredSegment.name}
            </ChartTooltipTitle>
            <ChartTooltipValue financial>
              {formatCurrency(hoveredSegment.amount, displayCurrency)}
            </ChartTooltipValue>
          </>
        )}
      </CursorTooltipPortal>
    </>
  )
}
