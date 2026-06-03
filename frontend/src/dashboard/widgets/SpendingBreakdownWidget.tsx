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
import { PieChart as PieChartIcon, Repeat } from 'lucide-react'
import {
  type CategoryBreakdownEntry,
  type SpendingRange,
  useSpendingBreakdown,
} from '@/api/dashboard'
import { AppScrambledNumber } from '@/components/AppScrambledNumber'
import { BreakdownCrossoverBadge } from '@/components/BreakdownCrossoverBadge'
import { AppSlotMachineText } from '@/components/AppSlotMachineText'
import CursorTooltipPortal from '@/components/charts/CursorTooltipPortal'
import IconTooltip from '@/components/IconTooltip'
import { TimeRangeSelector } from '@/components/TimeRangeSelector'
import { useLoadingSnapshot } from '@/components/useLoadingSnapshot'
import { formatCurrency } from '@/utils/formatCurrency'
import {
  BREAKDOWN_DONUT_TRANSITION,
  BREAKDOWN_PIE_ANIMATION_MS,
} from '@/dashboard/constants/animation'
import { DashboardWidgetLoadingBody } from '@/dashboard/components/DashboardWidgetLoadingBody'
import { DASHBOARD_RANGE_SELECT_OPTIONS } from '@/dashboard/constants/ranges'
import { formatDashboardMoney } from '@/dashboard/utils/formatDashboardMoney'
import { formatMissingFxPairs, getFxStatusTone } from '@/dashboard/utils/fxStatus'
import { getBreakdownFxStatusMessage } from '@/dashboard/utils/fxTooltipMessages'
import { getCategoryColor, getCategoryColorMap } from '@/utils/chartColor'
import { applyCursorTooltipPosition } from '@/utils/tooltipPosition'

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
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <div className="p-2 rounded-xl" style={{ background: 'var(--app-accent-soft)' }}>
          <PieChartIcon size={16} style={{ color: 'var(--app-accent)' }} aria-hidden />
        </div>
        <span className="app-label inline-flex items-baseline whitespace-nowrap">
          <AppSlotMachineText text={breakdownMode === 'spending' ? 'Spending' : 'Income'} />
          <span className="ml-[0.25em]">Breakdown</span>
        </span>
        {fxStatus && (
          <IconTooltip
            label="Spending breakdown FX status"
            icon="fx"
            fxTone={getFxStatusTone(fxStatus)}
            placement="top"
          >
            <span className="block">{getBreakdownFxStatusMessage(fxStatus, breakdownMode)}</span>
            {fxStatus.missing_pairs.length > 0 && (
              <span className="mt-2 block text-xs" style={{ color: 'var(--app-text-muted)' }}>
                Missing: {formatMissingFxPairs(fxStatus.missing_pairs)}
              </span>
            )}
          </IconTooltip>
        )}
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
                          <Cell key={entry.category_id} fill={getSpacedBreakdownColor(entry)} />
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
              </CursorTooltipPortal>
            </div>
            <div className="mt-3 flex flex-wrap justify-center gap-x-5 gap-y-2">
              {breakdownEntries.map((entry) => (
                <div key={entry.category_id} className="flex items-center gap-1.5">
                  <span
                    className="inline-block h-2.5 w-2.5 rounded-full"
                    style={{ background: getSpacedBreakdownColor(entry) }}
                  />
                  <span
                    className="whitespace-nowrap text-xs font-medium max-[1000px]:text-[0.675rem]"
                    style={{ color: 'var(--app-text-muted)' }}
                  >
                    {entry.name}
                  </span>
                  {renderCrossoverBadge(entry, breakdownMode)}
                </div>
              ))}
            </div>
          </>
        )}
      </DashboardWidgetLoadingBody>
    </div>
  )
}
