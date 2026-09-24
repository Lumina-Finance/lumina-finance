import { memo, useMemo, useRef, type ComponentProps } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import {
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Sector,
} from 'recharts'
import type { InsightsBreakdownCategoryKind } from '@/api/insights'
import { BreakdownCrossoverBadge } from '@/components/display/BreakdownCrossoverBadge'
import { ChartTooltipTitle, ChartTooltipValue } from '@/components/charts/TooltipContent'
import CursorTooltipPortal from '@/components/charts/CursorTooltipPortal'
import {
  getChartDataSignature,
  useChartEntranceAnimation,
} from '@/components/charts/useChartEntranceAnimation'
import { useCursorTooltip, type CursorTooltipPointer } from '@/hooks/useCursorTooltip'
import { useMoneyFormatters } from '@/hooks/useMoneyFormatters'
import type { BreakdownEntry } from '@/pages/insights/types/incomeExpenseBreakdown'
import {
  getBreakdownCrossoverKind,
  getBreakdownLegendEntries,
  getBreakdownLegendMinHeight,
  getBreakdownPercent,
  getBreakdownTotal,
} from '@/pages/insights/utils/incomeExpenseBreakdownDisplay'
import { getCategoryColor, getCategoryColorMap } from '@/utils/chartColor'

type IncomeExpensePieChartProps = {
  onCategorySelect: (categoryId: string) => void
  mode: InsightsBreakdownCategoryKind
  entries: BreakdownEntry[]
  total: number
  displayCurrency: string
  animationKey: string
  shouldReduceMotion: boolean
}

const pieLegendContainerVariants = {
  initial: { transition: { staggerChildren: 0.035 } },
  enter: { transition: { staggerChildren: 0.045, staggerDirection: -1, delayChildren: 0.03 } },
  exit: { transition: { staggerChildren: 0.035, staggerDirection: 1 } },
} as const

const pieLegendItemVariants = {
  initial: { opacity: 0, y: 8, filter: 'blur(2px)' },
  enter: { opacity: 1, y: 0, filter: 'blur(0px)' },
  exit: { opacity: 0, y: 8, filter: 'blur(2px)' },
} as const

const pieLegendItemTransition = { duration: 0.24, ease: [0.16, 1, 0.3, 1] } as const

function renderCrossoverBadge(entry: BreakdownEntry, mode: InsightsBreakdownCategoryKind) {
  const kind = getBreakdownCrossoverKind(entry, mode)
  return kind ? <BreakdownCrossoverBadge kind={kind} /> : null
}

/** Reads category identity without changing the tooltip callback across local state updates */
function getBreakdownEntryKey(entry: BreakdownEntry) {
  return entry.id
}

/** Reads the category's existing fallback color without depending on tooltip state */
function getBreakdownColor(entry: BreakdownEntry) {
  return getCategoryColor({
    id: entry.id,
    name: entry.name,
    kind: entry.categoryKind,
  })
}

type BreakdownPlotProps = {
  entries: BreakdownEntry[]
  colors: ReadonlyMap<string, string>
  onCategorySelect: (categoryId: string) => void
  showEntryTooltip: (entry: BreakdownEntry, pointer: CursorTooltipPointer) => void
  hideTooltip: () => void
}

/** Keeps the plotted subtree mounted while its parent updates tooltip state or measured layout */
const BreakdownPlot = memo(function BreakdownPlot({
  entries,
  colors,
  onCategorySelect,
  showEntryTooltip,
  hideTooltip,
}: BreakdownPlotProps) {
  const dataSignature = useMemo(
    () => getChartDataSignature(entries, (entry) => entry.amount),
    [entries],
  )
  const pieEntrance = useChartEntranceAnimation({ dataSignature })

  /** Gives every sector its own named keyboard action, including entries outside the short legend */
  function renderCategorySector(props: unknown) {
    const sector = props as ComponentProps<typeof Sector> & { payload: BreakdownEntry; animationElapsedTime: number }
    const entry = sector.payload
    // Recharts keys sectors by their animated angles, replacing the DOM until geometry settles.
    // Its isAnimating flag can stay set after an interrupted animation, so progress decides instead
    const disabled = sector.animationElapsedTime < 1
    const activate = () => {
      if (!disabled) onCategorySelect(entry.id)
    }
    return (
      <g
        role="button"
        tabIndex={disabled ? -1 : 0}
        aria-disabled={disabled}
        aria-label={`View ${entry.name} transactions`}
        className="app-breakdown-sector"
        onClick={activate}
        onKeyDown={(event) => {
          if (event.key !== 'Enter' && event.key !== ' ') return
          event.preventDefault()
          event.stopPropagation()
          activate()
        }}
      >
        <Sector {...sector} />
      </g>
    )
  }

  return (
    <ResponsiveContainer width="100%" height="100%">
      <PieChart>
        <Pie
          data={entries}
          cx="50%"
          cy="50%"
          innerRadius="62%"
          outerRadius="90%"
          paddingAngle={3}
          dataKey="amount"
          nameKey="name"
          stroke="none"
          shape={renderCategorySector}
          onMouseEnter={(_sector, index, event) => {
            showEntryTooltip(entries[index], event)
          }}
          onMouseMove={(_sector, index, event) => {
            showEntryTooltip(entries[index], event)
          }}
          onMouseLeave={hideTooltip}
          {...pieEntrance}
        >
          {entries.map((entry) => (
            <Cell key={entry.id} fill={colors.get(entry.id || entry.name) ?? getBreakdownColor(entry)} />
          ))}
        </Pie>
      </PieChart>
    </ResponsiveContainer>
  )
})

/**
 * Renders the income or expense donut chart, tooltip, total label, and legend
 */
export function IncomeExpensePieChart({
  onCategorySelect,
  mode,
  entries,
  total,
  displayCurrency,
  animationKey,
  shouldReduceMotion,
}: IncomeExpensePieChartProps) {
  const chartRef = useRef<HTMLDivElement>(null)
  const { formatCurrency } = useMoneyFormatters()
  const {
    tooltipRef,
    tooltipItem: hoveredEntry,
    tooltipVisible,
    showTooltip: showEntryTooltip,
    hideTooltip,
    handleTooltipTransitionEnd,
  } = useCursorTooltip<BreakdownEntry, HTMLDivElement>({
    originRef: chartRef,
    xProperty: '--breakdown-tooltip-x',
    yProperty: '--breakdown-tooltip-y',
    getItemKey: getBreakdownEntryKey,
  })
  const sliceTotal = getBreakdownTotal(entries)
  const breakdownColors = useMemo(() => getCategoryColorMap(entries.map((entry) => ({
    id: entry.id,
    name: entry.name,
    kind: entry.categoryKind,
  }))), [entries])
  const legendEntries = useMemo(
    () => getBreakdownLegendEntries(entries, mode),
    [entries, mode],
  )
  const legendMinHeight = getBreakdownLegendMinHeight(legendEntries.length)
  function getSpacedBreakdownColor(entry: BreakdownEntry) {
    return breakdownColors.get(entry.id || entry.name) ?? getBreakdownColor(entry)
  }
  return (
    <div className="flex flex-col min-[1350px]:min-h-[620px]">
      <div
        ref={chartRef}
        className="relative aspect-square max-h-[450px] w-full shrink-0"
        onMouseLeave={hideTooltip}
      >
        <div className="pointer-events-none absolute inset-0 z-10 flex flex-col items-center justify-center">
          <span className="app-label app-label-compact">
            Total {mode === 'expense' ? 'Expense' : 'Income'}
          </span>
          <span className="font-financial text-3xl leading-none tracking-tight">
            {formatCurrency(total, displayCurrency)}
          </span>
        </div>
        <BreakdownPlot
          entries={entries}
          colors={breakdownColors}
          onCategorySelect={onCategorySelect}
          showEntryTooltip={showEntryTooltip}
          hideTooltip={hideTooltip}
        />
        <CursorTooltipPortal
          ref={tooltipRef}
          className="min-w-40"
          onTransitionEnd={handleTooltipTransitionEnd}
          style={{
            opacity: tooltipVisible ? 1 : 0,
            transform: 'translate3d(var(--breakdown-tooltip-x, 0px), var(--breakdown-tooltip-y, 0px), 0)',
          }}
        >
          {hoveredEntry && (
            <>
              <div className="flex items-center gap-2">
                <ChartTooltipTitle>{hoveredEntry.name}</ChartTooltipTitle>
                {renderCrossoverBadge(hoveredEntry, mode)}
              </div>
              <ChartTooltipValue financial>
                {formatCurrency(hoveredEntry.amount, displayCurrency)}
              </ChartTooltipValue>
            </>
          )}
        </CursorTooltipPortal>
      </div>
      <div
        className="relative mt-auto overflow-hidden"
        style={{ minHeight: legendMinHeight }}
      >
        <AnimatePresence initial={false} mode="wait">
          <motion.div
            key={animationKey}
            className="absolute inset-x-5 bottom-0 space-y-2"
            variants={shouldReduceMotion ? undefined : pieLegendContainerVariants}
            initial={shouldReduceMotion ? false : 'initial'}
            animate={shouldReduceMotion ? { opacity: 1 } : 'enter'}
            exit={shouldReduceMotion ? undefined : 'exit'}
          >
            {legendEntries.map((entry) => (
              <motion.div
                key={entry.id}
                className="flex items-center gap-3 text-sm"
                variants={shouldReduceMotion ? undefined : pieLegendItemVariants}
                transition={shouldReduceMotion ? { duration: 0 } : pieLegendItemTransition}
              >
                <span
                  className="h-2.5 w-2.5 rounded-full"
                  style={{ background: getSpacedBreakdownColor(entry) }}
                />
                <span className="flex min-w-0 flex-1 items-center gap-2">
                  <span className="min-w-0 truncate" style={{ color: 'var(--app-text-muted)' }}>
                    {entry.name}
                  </span>
                  {renderCrossoverBadge(entry, mode)}
                </span>
                <span className="font-financial">
                  {getBreakdownPercent(entry.amount, sliceTotal)}%
                </span>
              </motion.div>
            ))}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  )
}
