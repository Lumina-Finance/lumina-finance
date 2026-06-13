import {
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type TransitionEvent as ReactTransitionEvent,
} from 'react'
import { AnimatePresence, motion } from 'motion/react'
import {
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
} from 'recharts'
import {
  type CategoryBreakdownEntry,
  type SpendingRange,
  useSpendingBreakdown,
} from '@/api/dashboard'
import { AppScrambledNumber } from '@/components/AppScrambledNumber'
import CursorTooltipPortal from '@/components/charts/CursorTooltipPortal'
import { useLoadingSnapshot } from '@/components/useLoadingSnapshot'
import {
  BREAKDOWN_DONUT_TRANSITION,
  BREAKDOWN_PIE_ANIMATION_MS,
} from '@/dashboard/constants/animation'
import { SpendingBreakdownHeader } from '@/dashboard/components/SpendingBreakdownHeader'
import { SpendingBreakdownLegend } from '@/dashboard/components/SpendingBreakdownLegend'
import { SpendingBreakdownTooltipContent } from '@/dashboard/components/SpendingBreakdownTooltipContent'
import { DashboardWidgetLoadingBody } from '@/dashboard/components/DashboardWidgetLoadingBody'
import { formatDashboardMoney } from '@/dashboard/utils/formatDashboardMoney'
import {
  getSpendingBreakdownEntryColor,
  getSpendingBreakdownSummary,
  type BreakdownMode,
} from '@/dashboard/utils/getSpendingBreakdownSummary'
import { applyCursorTooltipPosition } from '@/utils/tooltipPosition'

type SpendingBreakdownWidgetProps = {
  displayCurrency: string
}

export function SpendingBreakdownWidget({ displayCurrency }: SpendingBreakdownWidgetProps) {
  const breakdownChartRef = useRef<HTMLDivElement>(null)
  const breakdownTooltipRef = useRef<HTMLDivElement>(null)
  const [hoveredBreakdownEntry, setHoveredBreakdownEntry] = useState<CategoryBreakdownEntry | null>(null)
  const [breakdownTooltipVisible, setBreakdownTooltipVisible] = useState(false)
  const [breakdownMode, setBreakdownMode] = useState<BreakdownMode>('spending')
  const [breakdownRange, setBreakdownRange] = useState<SpendingRange>('MTD')
  const { data: incomingSpendingBreakdown, isFetching: spendingBreakdownLoading } = useSpendingBreakdown(breakdownRange)
  const loadingSnapshot = useMemo(
    () => ({ spendingBreakdown: incomingSpendingBreakdown }),
    [incomingSpendingBreakdown],
  )
  const {
    displaySnapshot,
    contentConcealed,
    loadingVisible,
    shouldReduceMotion,
  } = useLoadingSnapshot({
    snapshot: loadingSnapshot,
    loading: spendingBreakdownLoading,
    transitionKey: breakdownRange,
  })
  const spendingBreakdown = displaySnapshot.spendingBreakdown
  const fxStatus = spendingBreakdown?.fx_status
  const breakdownSummary = useMemo(
    () => getSpendingBreakdownSummary(spendingBreakdown, breakdownMode, breakdownRange),
    [breakdownMode, breakdownRange, spendingBreakdown],
  )
  const {
    entries: breakdownEntries,
    total: breakdownTotal,
    chartKey: breakdownChartKey,
  } = breakdownSummary
  const updateBreakdownTooltipPosition = (clientX: number, clientY: number) => {
    const chart = breakdownChartRef.current
    const tooltip = breakdownTooltipRef.current
    if (!chart || !tooltip) return

    applyCursorTooltipPosition({
      origin: chart,
      tooltip,
      clientX,
      clientY,
      xProperty: '--breakdown-tooltip-x',
      yProperty: '--breakdown-tooltip-y',
    })
  }
  const showBreakdownTooltip = (
    entry: CategoryBreakdownEntry | undefined,
    event: ReactMouseEvent<SVGGraphicsElement>,
  ) => {
    if (!entry) {
      setBreakdownTooltipVisible(false)
      return
    }

    updateBreakdownTooltipPosition(event.clientX, event.clientY)
    setHoveredBreakdownEntry((current) => (
      current?.category_id === entry.category_id ? current : entry
    ))
    setBreakdownTooltipVisible(true)
    requestAnimationFrame(() => updateBreakdownTooltipPosition(event.clientX, event.clientY))
  }
  const hideBreakdownTooltip = () => {
    setBreakdownTooltipVisible(false)
  }
  const handleBreakdownTooltipTransitionEnd = (event: ReactTransitionEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget || event.propertyName !== 'opacity' || breakdownTooltipVisible) return
    setHoveredBreakdownEntry(null)
  }

  return (
    <div className="app-card h-[470px] flex flex-col">
      <SpendingBreakdownHeader
        breakdownMode={breakdownMode}
        breakdownRange={breakdownRange}
        fxStatus={fxStatus}
        onModeToggle={() => setBreakdownMode((mode) => (mode === 'spending' ? 'income' : 'spending'))}
        onRangeChange={setBreakdownRange}
      />

      <DashboardWidgetLoadingBody
        contentConcealed={contentConcealed}
        loadingVisible={loadingVisible}
        shouldReduceMotion={shouldReduceMotion}
        label="Loading spending breakdown"
        className="flex-1"
        contentClassName="flex h-full min-h-0 flex-col"
      >
        {breakdownEntries.length === 0 ? (
          <div
            className="flex flex-1 items-center justify-center text-sm italic max-[1000px]:text-[0.7875rem]"
            style={{ color: 'var(--app-text-subtle)' }}
          >
            No {breakdownMode === 'spending' ? 'expense' : 'income'} activity in this range
          </div>
        ) : (
          <>
            <div
              ref={breakdownChartRef}
              className="relative min-h-0 flex-1"
              onMouseLeave={hideBreakdownTooltip}
            >
              <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                <span className="app-label app-label-compact">
                  Total {breakdownMode === 'spending' ? 'Expense' : 'Income'}
                </span>
                <span className="font-financial mt-1 text-3xl font-normal tracking-tight max-[1000px]:text-[1.6875rem]">
                  <AppScrambledNumber text={formatDashboardMoney(breakdownTotal, displayCurrency, 'breakdown')} />
                </span>
              </div>
              <AnimatePresence initial={false}>
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
                          <Cell
                            key={entry.category_id}
                            fill={getSpendingBreakdownEntryColor(entry, breakdownSummary)}
                          />
                        ))}
                      </Pie>
                    </PieChart>
                  </ResponsiveContainer>
                </motion.div>
              </AnimatePresence>
              <CursorTooltipPortal
                ref={breakdownTooltipRef}
                className="min-w-40"
                onTransitionEnd={handleBreakdownTooltipTransitionEnd}
                style={{
                  opacity: breakdownTooltipVisible ? 1 : 0,
                  transform: 'translate3d(var(--breakdown-tooltip-x, 0px), var(--breakdown-tooltip-y, 0px), 0)',
                }}
              >
                {hoveredBreakdownEntry && (
                  <SpendingBreakdownTooltipContent
                    entry={hoveredBreakdownEntry}
                    breakdownMode={breakdownMode}
                    displayCurrency={displayCurrency}
                  />
                )}
              </CursorTooltipPortal>
            </div>
            <SpendingBreakdownLegend
              entries={breakdownEntries}
              breakdownMode={breakdownMode}
              summary={breakdownSummary}
            />
          </>
        )}
      </DashboardWidgetLoadingBody>
    </div>
  )
}
