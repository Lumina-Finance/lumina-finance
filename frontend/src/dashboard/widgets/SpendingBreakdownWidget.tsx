import { useMemo, useState } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import {
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
} from 'recharts'
import { ArrowDownLeft, PieChart as PieChartIcon, Repeat } from 'lucide-react'
import {
  type CategoryBreakdownEntry,
  type SpendingRange,
  useSpendingBreakdown,
} from '@/api/dashboard'
import { AppScrambledNumber } from '@/components/AppScrambledNumber'
import { AppSlotMachineText } from '@/components/AppSlotMachineText'
import { TimeRangeSelector } from '@/components/TimeRangeSelector'
import { formatCurrency } from '@/utils/formatCurrency'
import {
  BREAKDOWN_DONUT_TRANSITION,
  BREAKDOWN_PIE_ANIMATION_MS,
} from '@/dashboard/constants/animation'
import { DASHBOARD_RANGE_SELECT_OPTIONS } from '@/dashboard/constants/ranges'
import { useBreakdownTooltipPosition } from '@/dashboard/hooks/useBreakdownTooltipPosition'
import { formatDashboardMoney } from '@/dashboard/utils/formatDashboardMoney'
import { getCategoryColor, getCategoryColorMap } from '@/utils/chartColor'

type SpendingBreakdownWidgetProps = {
  displayCurrency: string
}

type BreakdownMode = 'spending' | 'income'

function isIncomeLossEntry(entry: CategoryBreakdownEntry, mode: BreakdownMode) {
  return mode === 'spending' && entry.category_kind === 'income'
}

function IncomeLossBadge() {
  return (
    <span
      className="inline-flex h-4 shrink-0 items-center gap-0.5 rounded border px-1 text-[0.625rem] font-semibold leading-none"
      style={{
        background: 'var(--app-negative-soft)',
        borderColor: 'var(--app-negative-border)',
        color: 'var(--app-negative)',
      }}
      title="Income category counted as expense"
    >
      <ArrowDownLeft size={10} strokeWidth={2.2} aria-hidden />
      Income loss
    </span>
  )
}

export function SpendingBreakdownWidget({ displayCurrency }: SpendingBreakdownWidgetProps) {
  const shouldReduceMotion = useReducedMotion()
  const {
    breakdownTipPos,
    handleBreakdownMouseLeave,
    handleBreakdownMouseMove,
  } = useBreakdownTooltipPosition()
  const [breakdownMode, setBreakdownMode] = useState<BreakdownMode>('spending')
  const [breakdownRange, setBreakdownRange] = useState<SpendingRange>('MTD')
  const { data: spendingBreakdown, isLoading: spendingBreakdownLoading } = useSpendingBreakdown(breakdownRange)
  const breakdownEntries = useMemo(() => {
    if (!spendingBreakdown) return []
    return breakdownMode === 'spending' ? spendingBreakdown.expense : spendingBreakdown.income
  }, [spendingBreakdown, breakdownMode])
  const breakdownTotal = breakdownEntries.reduce((sum, entry) => sum + entry.amount, 0)
  const breakdownChartKey = `${breakdownMode}-${breakdownRange}`
  const breakdownLoadingText = formatDashboardMoney(88888800, displayCurrency, 'breakdown')
  const breakdownCategoryKind = breakdownMode === 'spending' ? 'expense' : 'income'
  const breakdownColors = useMemo(() => getCategoryColorMap(breakdownEntries.map((entry) => ({
    id: entry.category_id,
    name: entry.name,
    kind: entry.category_kind || breakdownCategoryKind,
  }))), [breakdownEntries, breakdownCategoryKind])
  const getBreakdownColor = (entry: CategoryBreakdownEntry) => getCategoryColor({
    id: entry.category_id,
    name: entry.name,
    kind: entry.category_kind || breakdownCategoryKind,
  })
  const getSpacedBreakdownColor = (entry: CategoryBreakdownEntry) => (
    breakdownColors.get(entry.category_id || entry.name) ?? getBreakdownColor(entry)
  )

  return (
    <div className="app-card h-[420px] flex flex-col">
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
            className="flex-1 min-h-0 relative"
            onMouseMove={handleBreakdownMouseMove}
            onMouseLeave={handleBreakdownMouseLeave}
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
                      >
                        {breakdownEntries.map((entry) => (
                          <Cell key={entry.category_id} fill={getSpacedBreakdownColor(entry)} />
                        ))}
                      </Pie>
                      <Tooltip
                        wrapperClassName="app-chart-tooltip-default"
                        cursor={false}
                        position={breakdownTipPos ?? undefined}
                        content={({ active, payload }) => {
                          const entry = payload?.[0]?.payload as CategoryBreakdownEntry | undefined
                          if (!active || !entry) return null

                          return (
                            <div className="app-chart-tooltip-default-content min-w-40">
                              <div className="flex items-center gap-2">
                                <span className="font-medium" style={{ color: 'var(--app-text)' }}>
                                  {entry.name}
                                </span>
                                {isIncomeLossEntry(entry, breakdownMode) && <IncomeLossBadge />}
                              </div>
                              <div className="mt-1 font-financial" style={{ color: 'var(--app-text)' }}>
                                {formatCurrency(entry.amount, displayCurrency)}
                              </div>
                            </div>
                          )
                        }}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
          {breakdownEntries.length > 0 && (
            <div className="flex flex-wrap justify-center gap-x-5 gap-y-2 mt-3">
              {breakdownEntries.slice(0, 6).map((entry) => (
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
                  {isIncomeLossEntry(entry, breakdownMode) && <IncomeLossBadge />}
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}
