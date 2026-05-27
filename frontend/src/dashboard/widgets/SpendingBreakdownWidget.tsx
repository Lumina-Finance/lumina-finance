import { useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import {
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
} from 'recharts'
import { PieChart as PieChartIcon, Repeat } from 'lucide-react'
import {
  type CategoryBreakdownEntry,
  type SpendingRange,
  useSpendingBreakdown,
} from '@/api/dashboard'
import { AppScrambledNumber } from '@/components/AppScrambledNumber'
import { BreakdownCrossoverBadge } from '@/components/BreakdownCrossoverBadge'
import { AppSlotMachineText } from '@/components/AppSlotMachineText'
import { TimeRangeSelector } from '@/components/TimeRangeSelector'
import { formatCurrency } from '@/utils/formatCurrency'
import {
  BREAKDOWN_DONUT_TRANSITION,
  BREAKDOWN_PIE_ANIMATION_MS,
} from '@/dashboard/constants/animation'
import { DASHBOARD_RANGE_SELECT_OPTIONS } from '@/dashboard/constants/ranges'
import { formatDashboardMoney } from '@/dashboard/utils/formatDashboardMoney'
import { getCategoryColor, getCategoryColorMap } from '@/utils/chartColor'

type SpendingBreakdownWidgetProps = {
  displayCurrency: string
}

type BreakdownMode = 'spending' | 'income'

function getCrossoverKind(entry: CategoryBreakdownEntry, mode: BreakdownMode) {
  if (mode === 'spending' && entry.category_kind === 'income') return 'income-loss'
  if (mode === 'income' && entry.category_kind === 'expense') return 'expense-refund'
  return null
}

function renderCrossoverBadge(entry: CategoryBreakdownEntry, mode: BreakdownMode) {
  const kind = getCrossoverKind(entry, mode)
  return kind ? <BreakdownCrossoverBadge kind={kind} /> : null
}

function getBreakdownCategoryColorId(
  entry: CategoryBreakdownEntry,
  fallbackKind: CategoryBreakdownEntry['category_kind'],
) {
  return entry.name === 'Other'
    ? `${entry.category_kind || fallbackKind}-other`
    : entry.category_id
}

function getEntryTotal(entries: CategoryBreakdownEntry[]) {
  return entries.reduce((sum, entry) => sum + entry.amount, 0)
}

export function SpendingBreakdownWidget({ displayCurrency }: SpendingBreakdownWidgetProps) {
  const shouldReduceMotion = useReducedMotion()
  const breakdownChartRef = useRef<HTMLDivElement>(null)
  const breakdownTooltipRef = useRef<HTMLDivElement>(null)
  const [hoveredBreakdownEntry, setHoveredBreakdownEntry] = useState<CategoryBreakdownEntry | null>(null)
  const [breakdownMode, setBreakdownMode] = useState<BreakdownMode>('spending')
  const [breakdownRange, setBreakdownRange] = useState<SpendingRange>('MTD')
  const { data: spendingBreakdown, isLoading: spendingBreakdownLoading } = useSpendingBreakdown(breakdownRange)
  const breakdownEntries = useMemo(() => {
    if (!spendingBreakdown) return []
    return breakdownMode === 'spending' ? spendingBreakdown.expense : spendingBreakdown.income
  }, [spendingBreakdown, breakdownMode])
  const fallbackBreakdownTotal = getEntryTotal(breakdownEntries)
  const breakdownTotal = spendingBreakdown
    ? breakdownMode === 'spending'
      ? spendingBreakdown.expense_total
      : spendingBreakdown.income_total
    : fallbackBreakdownTotal
  const breakdownChartKey = `${breakdownMode}-${breakdownRange}`
  const breakdownLoadingText = formatDashboardMoney(88888800, displayCurrency, 'breakdown')
  const breakdownCategoryKind = breakdownMode === 'spending' ? 'expense' : 'income'
  const breakdownColors = useMemo(() => getCategoryColorMap(breakdownEntries.map((entry) => ({
    id: getBreakdownCategoryColorId(entry, breakdownCategoryKind),
    name: entry.name,
    kind: entry.category_kind || breakdownCategoryKind,
  }))), [breakdownEntries, breakdownCategoryKind])
  const getBreakdownColor = (entry: CategoryBreakdownEntry) => getCategoryColor({
    id: getBreakdownCategoryColorId(entry, breakdownCategoryKind),
    name: entry.name,
    kind: entry.category_kind || breakdownCategoryKind,
  })
  const getSpacedBreakdownColor = (entry: CategoryBreakdownEntry) => (
    breakdownColors.get(getBreakdownCategoryColorId(entry, breakdownCategoryKind) || entry.name)
      ?? getBreakdownColor(entry)
  )
  const updateBreakdownTooltipPosition = (event: ReactMouseEvent<SVGGraphicsElement>) => {
    const rect = breakdownChartRef.current?.getBoundingClientRect()
    const tooltip = breakdownTooltipRef.current
    if (!rect || !tooltip) return

    tooltip.style.setProperty('--breakdown-tooltip-x', `${event.clientX - rect.left}px`)
    tooltip.style.setProperty('--breakdown-tooltip-y', `${event.clientY - rect.top}px`)
  }
  const showBreakdownTooltip = (
    entry: CategoryBreakdownEntry | undefined,
    event: ReactMouseEvent<SVGGraphicsElement>,
  ) => {
    if (!entry) return

    updateBreakdownTooltipPosition(event)
    setHoveredBreakdownEntry((current) => (
      current?.category_id === entry.category_id ? current : entry
    ))
  }
  const hideBreakdownTooltip = () => {
    setHoveredBreakdownEntry(null)
  }

  return (
    <div className="app-card h-[470px] flex flex-col">
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <div className="p-2 rounded-xl" style={{ background: 'var(--app-accent-soft)' }}>
          <PieChartIcon size={16} style={{ color: 'var(--app-accent)' }} aria-hidden />
        </div>
        <span className="app-label inline-flex items-baseline whitespace-nowrap">
          <AppSlotMachineText text={breakdownMode === 'spending' ? 'Spending' : 'Income'} />
          <span className="ml-[0.25em]">Breakdown</span>
        </span>
        <button
          type="button"
          onClick={() => setBreakdownMode((mode) => (mode === 'spending' ? 'income' : 'spending'))}
          title={breakdownMode === 'spending' ? 'Show income breakdown' : 'Show spending breakdown'}
          aria-label={breakdownMode === 'spending' ? 'Show income breakdown' : 'Show spending breakdown'}
          className="app-icon-button ml-auto"
        >
          <Repeat size={12} />
        </button>
        <TimeRangeSelector
          value={breakdownRange}
          options={DASHBOARD_RANGE_SELECT_OPTIONS}
          onChange={setBreakdownRange}
          ariaLabel="Breakdown range"
          className="hidden min-[730px]:inline-flex"
        />
        <TimeRangeSelector
          value={breakdownRange}
          options={DASHBOARD_RANGE_SELECT_OPTIONS}
          onChange={setBreakdownRange}
          ariaLabel="Breakdown range"
          variant="mobile"
          className="w-full min-[730px]:hidden"
          sheetTitle="Breakdown range"
        />
      </div>

      {breakdownEntries.length === 0 && !spendingBreakdownLoading ? (
        <div
          className="flex-1 flex items-center justify-center text-sm italic max-[1000px]:text-[0.7875rem]"
          style={{ color: 'var(--app-text-subtle)' }}
        >
          No {breakdownMode === 'spending' ? 'expense' : 'income'} activity in this range
        </div>
      ) : (
        <>
          <div
            ref={breakdownChartRef}
            className="flex-1 min-h-0 relative"
            onMouseLeave={hideBreakdownTooltip}
          >
            <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
              <span className="app-label app-label-compact">
                Total {breakdownMode === 'spending' ? 'Expense' : 'Income'}
              </span>
              <span className="font-financial font-normal tracking-tight text-3xl mt-1 max-[1000px]:text-[1.6875rem]">
                <AppScrambledNumber
                  text={formatDashboardMoney(breakdownTotal, displayCurrency, 'breakdown')}
                  loading={spendingBreakdownLoading}
                  loadingText={breakdownLoadingText}
                />
              </span>
            </div>
            <AnimatePresence initial={false}>
              {breakdownEntries.length > 0 && (
                <motion.div
                  key={breakdownChartKey}
                  className="absolute inset-0"
                  initial={shouldReduceMotion ? false : { opacity: 0, scale: 0.975 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={shouldReduceMotion ? undefined : { opacity: 0, scale: 1.015 }}
                  transition={shouldReduceMotion ? { duration: 0 } : BREAKDOWN_DONUT_TRANSITION}
                >
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={breakdownEntries}
                        cx="50%"
                        cy="50%"
                        innerRadius="68%"
                        outerRadius="92%"
                        paddingAngle={3}
                        dataKey="amount"
                        nameKey="name"
                        stroke="none"
                        isAnimationActive={!shouldReduceMotion}
                        animationDuration={shouldReduceMotion ? 0 : BREAKDOWN_PIE_ANIMATION_MS}
                        animationEasing="ease-out"
                        onMouseEnter={(_sector, index, event) => {
                          showBreakdownTooltip(breakdownEntries[index], event)
                        }}
                        onMouseMove={(_sector, index, event) => {
                          showBreakdownTooltip(breakdownEntries[index], event)
                        }}
                        onMouseLeave={hideBreakdownTooltip}
                      >
                        {breakdownEntries.map((entry) => (
                          <Cell key={entry.category_id} fill={getSpacedBreakdownColor(entry)} />
                        ))}
                      </Pie>
                    </PieChart>
                  </ResponsiveContainer>
                </motion.div>
              )}
            </AnimatePresence>
            <div
              ref={breakdownTooltipRef}
              className="app-chart-tooltip-default-content pointer-events-none absolute left-0 top-0 z-20 min-w-40"
              style={{
                opacity: hoveredBreakdownEntry ? 1 : 0,
                transition: 'opacity 150ms ease-out',
                transform: 'translate3d(var(--breakdown-tooltip-x, 0px), var(--breakdown-tooltip-y, 0px), 0)',
              }}
            >
              {hoveredBreakdownEntry && (
                <>
                  <div className="flex items-center gap-2">
                    <span className="app-chart-tooltip-default-title">
                      {hoveredBreakdownEntry.name}
                    </span>
                    {renderCrossoverBadge(hoveredBreakdownEntry, breakdownMode)}
                  </div>
                  <div className="app-chart-tooltip-default-value">
                    {formatCurrency(hoveredBreakdownEntry.amount, displayCurrency)}
                  </div>
                </>
              )}
            </div>
          </div>
          {breakdownEntries.length > 0 && (
            <div className="flex flex-wrap justify-center gap-x-5 gap-y-2 mt-3">
              {breakdownEntries.map((entry) => (
                <div key={entry.category_id} className="flex items-center gap-1.5">
                  <span
                    className="inline-block w-2.5 h-2.5 rounded-full"
                    style={{ background: getSpacedBreakdownColor(entry) }}
                  />
                  <span
                    className="text-xs font-medium whitespace-nowrap max-[1000px]:text-[0.675rem]"
                    style={{ color: 'var(--app-text-muted)' }}
                  >
                    {entry.name}
                  </span>
                  {renderCrossoverBadge(entry, breakdownMode)}
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}
