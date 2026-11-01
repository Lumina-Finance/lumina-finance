import { BarChart3 } from 'lucide-react'
import { useLayoutEffect, useRef, useState, type RefObject } from 'react'
import type { SpendingRange } from '@/api/dashboard'
import type { FxStatus } from '@/api/shared/fx'
import { AppSlotMachineText } from '@/components/display/SlotMachineText'
import { FxStatusBadge } from '@/components/tooltips/FxStatusBadge'
import { DashboardRangeSelector } from '@/pages/dashboard/components/RangeSelector'
import { DashboardWidgetHeaderIcon } from '@/pages/dashboard/components/WidgetHeaderIcon'
import { DASHBOARD_RANGE_SELECT_OPTIONS, PREVIOUS_PERIOD_LABEL_BY_RANGE } from '@/pages/dashboard/constants/ranges'
import { getSpendingAverageFxStatusMessage, getSpendingComparisonFxStatusMessage } from '@/utils/fxTooltipMessages'

type SpendingComparisonHeaderProps = {
  spendingRange: SpendingRange
  fxStatus: FxStatus | undefined

  /** The conversions behind the average alone, which flag only the average when a rate is missing */
  averageFxStatus: FxStatus | undefined

  /** Whether the line being compared with is the average, which the title says */
  showAverage: boolean
  onRangeChange: (range: SpendingRange) => void
}

const ROW_GAP_PX = 8
const MEASURED_ATTRIBUTE = 'data-title-measure'

/**
 * Counts the lines a wrapping row of the given item widths takes, as the header's flex row lays them out
 */
function countLines(widths: number[], rowWidth: number): number {
  let lines = 1
  let used = 0
  for (const width of widths) {
    const next = used === 0 ? width : used + ROW_GAP_PX + width
    if (used > 0 && next > rowWidth) {
      lines += 1
      used = width
    } else {
      used = next
    }
  }
  return lines
}

type AverageTitle = 'full' | 'short' | 'tight'

/**
 * Says how the title has to be written so it never pushes the controls onto a row they would not take anyway: with
 * "average" spelled out, with "avg." and its letters closer, or with "avg." and the whole title's letters closer.
 * It lays the row out from the items' widths and hidden copies of the title, so the answer depends on the row's
 * width alone and the title's own roll can't make it flip back and forth
 */
function useAverageTitle(
  rowRef: RefObject<HTMLDivElement | null>,
  fullRef: RefObject<HTMLSpanElement | null>,
  shortRef: RefObject<HTMLSpanElement | null>,
  key: string,
): AverageTitle {
  const [fits, setFits] = useState<AverageTitle>('short')
  useLayoutEffect(() => {
    const row = rowRef.current
    if (!row) return undefined
    const measure = () => {
      const fullWidth = fullRef.current?.getBoundingClientRect().width
      const shortWidth = shortRef.current?.getBoundingClientRect().width
      if (fullWidth === undefined || shortWidth === undefined) return
      // The first child after the icon is the title, so its slot takes the width being tried
      // A control hidden at this width takes no room and no gap, such as the range dropdown on a wide screen
      const others = [...row.children].filter(
        (child) => !child.hasAttribute(MEASURED_ATTRIBUTE) && getComputedStyle(child).display !== 'none',
      )
      const widths = others.map((child) => child.getBoundingClientRect().width)
      const withTitle = (titleWidth: number) => widths.map((width, index) => (index === 1 ? titleWidth : width))
      const rowWidth = row.clientWidth
      // A form is used only where the title does not push the controls onto a row they would not take with no title
      // in the way, so the selector never wraps because of the title
      const wanted = countLines(withTitle(0), rowWidth)
      if (countLines(withTitle(fullWidth), rowWidth) <= wanted) setFits('full')
      else if (countLines(withTitle(shortWidth), rowWidth) <= wanted) setFits('short')
      else setFits('tight')
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(row)
    // The selector and badge change size with the screen too, and the row's own width can stay the same
    for (const child of row.children) observer.observe(child)
    return () => observer.disconnect()
  }, [rowRef, fullRef, shortRef, key])
  return fits
}

/**
 * Renders the spending comparison title, FX status, and responsive range controls
 */
export function SpendingComparisonHeader({
  spendingRange,
  fxStatus,
  averageFxStatus,
  showAverage,
  onRangeChange,
}: SpendingComparisonHeaderProps) {
  const rowRef = useRef<HTMLDivElement>(null)
  const fullRef = useRef<HTMLSpanElement>(null)
  const shortRef = useRef<HTMLSpanElement>(null)
  const periodLabel = PREVIOUS_PERIOD_LABEL_BY_RANGE[spendingRange]
  const averageTitle = useAverageTitle(rowRef, fullRef, shortRef, periodLabel)
  // The title spells out "average" where the selector keeps its place beside it and shortens it wherever the full
  // word would push the selector onto its own row
  const hasFullWord = averageTitle === 'full'
  const averageWord = hasFullWord ? 'average' : 'avg.'
  return (
    <div ref={rowRef} className="relative flex flex-wrap items-center gap-2 mb-3">
      <DashboardWidgetHeaderIcon icon={BarChart3} />
      {/* Hidden copies of the title that only give its widths, in the same type as the title */}
      <span
        {...{ [MEASURED_ATTRIBUTE]: '' }}
        ref={fullRef}
        aria-hidden
        className="app-label pointer-events-none invisible absolute whitespace-nowrap"
      >
        Spending vs.&nbsp;average&nbsp;{periodLabel}
      </span>
      <span
        {...{ [MEASURED_ATTRIBUTE]: '' }}
        ref={shortRef}
        aria-hidden
        className="app-label pointer-events-none invisible absolute whitespace-nowrap"
      >
        Spending vs.&nbsp;<span style={{ letterSpacing: '-0.04em' }}>avg.</span>&nbsp;{periodLabel}
      </span>
      <span
        className="app-label inline-flex items-baseline whitespace-nowrap"
        style={showAverage && averageTitle === 'tight' ? { letterSpacing: '-0.04em' } : undefined}
      >
        Spending vs.&nbsp;
        {/* "avg." is wider than "last", and the range selector shares the row with the title to the pixel at 1280,
            so its letters sit a little closer to keep the selector where it was */}
        <AppSlotMachineText
          text={showAverage ? averageWord : 'last'}
          style={showAverage && !hasFullWord ? { letterSpacing: '-0.04em' } : undefined}
        />
        &nbsp;
        <AppSlotMachineText text={periodLabel} />
      </span>
      <FxStatusBadge
        label="Spending comparison FX status"
        fxStatus={fxStatus}
        getMessage={getSpendingComparisonFxStatusMessage}
      />
      {showAverage && (averageFxStatus?.state === 'incomplete' || averageFxStatus?.state === 'unavailable') && (
        <FxStatusBadge
          label="Average FX status"
          fxStatus={averageFxStatus}
          getMessage={getSpendingAverageFxStatusMessage}
        />
      )}
      <DashboardRangeSelector
        value={spendingRange}
        options={DASHBOARD_RANGE_SELECT_OPTIONS}
        onChange={onRangeChange}
        ariaLabel="Spending range"
        sheetTitle="Spending range"
      />
    </div>
  )
}
