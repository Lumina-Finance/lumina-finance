import {
  useMemo,
  useRef,
} from 'react'
import { AnimatePresence, motion } from 'motion/react'
import {
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
} from 'recharts'
import type { InsightsBreakdownCategoryKind } from '@/api/insights'
import { BreakdownCrossoverBadge } from '@/components/display/BreakdownCrossoverBadge'
import { ChartTooltipTitle, ChartTooltipValue } from '@/components/charts/TooltipContent'
import CursorTooltipPortal from '@/components/charts/CursorTooltipPortal'
import { useCursorTooltip } from '@/hooks/useCursorTooltip'
import type { BreakdownEntry } from '@/pages/insights/types/incomeExpenseBreakdown'
import {
  getBreakdownCrossoverKind,
  getBreakdownLegendEntries,
  getBreakdownLegendMinHeight,
  getBreakdownPercent,
  getBreakdownTotal,
} from '@/pages/insights/utils/incomeExpenseBreakdownDisplay'
import { getCategoryColor, getCategoryColorMap } from '@/utils/chartColor'
import { formatCurrency } from '@/utils/formatCurrency'

type IncomeExpensePieChartProps = {
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

/**
 * Renders the income or expense donut chart, tooltip, total label, and legend
 */
export function IncomeExpensePieChart({
  mode,
  entries,
  total,
  displayCurrency,
  animationKey,
  shouldReduceMotion,
}: IncomeExpensePieChartProps) {
  const chartRef = useRef<HTMLDivElement>(null)
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
    getItemKey: (entry) => entry.id,
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

  function getBreakdownColor(entry: BreakdownEntry) {
    return getCategoryColor({
      id: entry.id,
      name: entry.name,
      kind: entry.categoryKind,
    })
  }

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
              onMouseEnter={(_sector, index, event) => {
                showEntryTooltip(entries[index], event)
              }}
              onMouseMove={(_sector, index, event) => {
                showEntryTooltip(entries[index], event)
              }}
              onMouseLeave={hideTooltip}
            >
              {entries.map((entry) => (
                <Cell key={entry.id} fill={getSpacedBreakdownColor(entry)} />
              ))}
            </Pie>
          </PieChart>
        </ResponsiveContainer>
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
