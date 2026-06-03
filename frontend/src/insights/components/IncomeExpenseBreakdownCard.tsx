import {
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type TransitionEvent as ReactTransitionEvent,
} from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { PieChart as PieChartIcon, Repeat } from 'lucide-react'
import {
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
} from 'recharts'
import type { FxStatus } from '@/api/dashboard'
import IconTooltip from '@/components/IconTooltip'
import { getIncomeExpenseBreakdownFxStatusMessage } from '@/insights/utils/fxTooltipMessages'
import { formatCurrency } from '@/utils/formatCurrency'
import {
  InsightLoadingContent,
  InsightLoadingOverlay,
} from './InsightLoadingTransition'
import { AppSlotMachineText } from '@/components/AppSlotMachineText'
import { BreakdownCrossoverBadge } from '@/components/BreakdownCrossoverBadge'
import CursorTooltipPortal from '@/components/charts/CursorTooltipPortal'
import { FxStatusBadge } from './FxStatusBadge'
import { InsightActionButton } from './InsightActionButton'
import { SectionHeader } from './SectionHeader'
import { useInsightLoadingSnapshot } from './useInsightLoadingSnapshot'
import { getCategoryColor, getCategoryColorMap } from '@/utils/chartColor'
import { applyCursorTooltipPosition } from '@/utils/tooltipPosition'

export type BreakdownMode = 'expense' | 'income'

export type BreakdownEntry = {
  id: string
  name: string
  categoryKind: BreakdownMode
  amount: number
}

export type CategoryDriver = {
  id: string
  name: string
  amount: number
  previousAmount: number
  changePct: number | null
  transactionCount: number
}

export type CategoryTrendSection = {
  id: 'increases' | 'decreases'
  label: string
  drivers: CategoryDriver[]
}

type IncomeExpenseBreakdownCardProps = {
  mode: BreakdownMode
  onModeToggle: () => void
  entries: BreakdownEntry[]
  total: number
  trendSections: CategoryTrendSection[]
  fxStatus: FxStatus | undefined
  displayCurrency: string
  animationKey: string
  loading?: boolean
  transitionKey: string
}

type IncomeExpenseBreakdownSnapshot = {
  mode: BreakdownMode
  entries: BreakdownEntry[]
  total: number
  trendSections: CategoryTrendSection[]
  fxStatus: FxStatus | undefined
  displayCurrency: string
  animationKey: string
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
const PIE_LEGEND_LIMIT = 5
const PIE_LEGEND_ROW_HEIGHT = 20
const PIE_LEGEND_ROW_GAP = 8
const PIE_LEGEND_MIN_HEIGHT = 136

const categoryTrendListVariants = {
  initial: { transition: { staggerChildren: 0.03 } },
  enter: { transition: { staggerChildren: 0.045, delayChildren: 0.03 } },
  exit: { transition: { staggerChildren: 0.035, staggerDirection: -1 } },
} as const

function getTotal(entries: BreakdownEntry[]) {
  return entries.reduce((sum, entry) => sum + entry.amount, 0)
}

function getPct(amount: number, total: number) {
  if (total <= 0) return 0
  return Math.round((amount / total) * 100)
}

function formatSignedCurrency(amount: number, currency: string) {
  if (amount === 0) return formatCurrency(amount, currency)
  return `${amount > 0 ? '+' : '-'}${formatCurrency(Math.abs(amount), currency)}`
}

function getCategoryDriverColor(mode: BreakdownMode, changeAmount: number) {
  if (changeAmount === 0) return 'var(--app-text-muted)'
  if (mode === 'income') return changeAmount > 0 ? 'var(--app-chart-positive)' : 'var(--app-chart-negative)'
  return changeAmount > 0 ? 'var(--app-chart-negative)' : 'var(--app-chart-positive)'
}

function getCategoryDriverDescriptor(changeAmount: number) {
  if (changeAmount === 0) return 'flat'
  return changeAmount > 0 ? 'increase' : 'decrease'
}

function getTransactionCountLabel(count: number) {
  return `${count} ${count === 1 ? 'transaction' : 'transactions'}`
}

function getCrossoverKind(entry: BreakdownEntry, mode: BreakdownMode) {
  if (mode === 'expense' && entry.categoryKind === 'income') return 'income-loss'
  if (mode === 'income' && entry.categoryKind === 'expense') return 'expense-refund'
  return null
}

function getBreakdownCalculation(mode: BreakdownMode) {
  return mode === 'expense'
    ? 'Spending by category for this range. Refunds reduce spending first before flipping into income. Transfers are excluded'
    : 'Income by category for this range. Reversals reduce income first before flipping into spending. Transfers are excluded'
}

function getTrendSectionCalculation(sectionId: CategoryTrendSection['id']) {
  return sectionId === 'increases'
    ? 'Compared with the previous matching period, sorted by biggest increase'
    : 'Compared with the previous matching period, sorted by biggest decrease'
}

function renderCrossoverBadge(entry: BreakdownEntry, mode: BreakdownMode) {
  const kind = getCrossoverKind(entry, mode)
  return kind ? <BreakdownCrossoverBadge kind={kind} /> : null
}

function getLegendEntries(entries: BreakdownEntry[], mode: BreakdownMode) {
  const visibleEntries = entries.slice(0, PIE_LEGEND_LIMIT)
  const visibleIds = new Set(visibleEntries.map((entry) => entry.id))
  const hiddenFlippedEntries = entries
    .slice(PIE_LEGEND_LIMIT)
    .filter((entry) => getCrossoverKind(entry, mode) && !visibleIds.has(entry.id))

  return [...visibleEntries, ...hiddenFlippedEntries]
}

function getLegendMinHeight(entryCount: number) {
  if (entryCount <= 0) return PIE_LEGEND_MIN_HEIGHT

  return Math.max(
    PIE_LEGEND_MIN_HEIGHT,
    entryCount * PIE_LEGEND_ROW_HEIGHT + (entryCount - 1) * PIE_LEGEND_ROW_GAP + 4,
  )
}

export function IncomeExpenseBreakdownCard({
  mode,
  onModeToggle,
  entries,
  total,
  trendSections,
  fxStatus,
  displayCurrency,
  animationKey,
  loading = false,
  transitionKey,
}: IncomeExpenseBreakdownCardProps) {
  const breakdownChartRef = useRef<HTMLDivElement>(null)
  const breakdownTooltipRef = useRef<HTMLDivElement>(null)
  const [hoveredBreakdownEntry, setHoveredBreakdownEntry] = useState<BreakdownEntry | null>(null)
  const [breakdownTooltipVisible, setBreakdownTooltipVisible] = useState(false)
  const incomingSnapshot = useMemo<IncomeExpenseBreakdownSnapshot>(() => ({
    mode,
    entries,
    total,
    trendSections,
    fxStatus,
    displayCurrency,
    animationKey,
  }), [animationKey, displayCurrency, entries, fxStatus, mode, total, trendSections])
  const {
    displaySnapshot,
    contentConcealed,
    loadingVisible,
    shouldReduceMotion,
  } = useInsightLoadingSnapshot<IncomeExpenseBreakdownSnapshot>({
    snapshot: incomingSnapshot,
    loading,
    transitionKey,
  })
  const sliceTotal = getTotal(displaySnapshot.entries)
  const breakdownColors = useMemo(() => getCategoryColorMap(displaySnapshot.entries.map((entry) => ({
    id: entry.id,
    name: entry.name,
    kind: entry.categoryKind,
  }))), [displaySnapshot.entries])
  const getBreakdownColor = (entry: BreakdownEntry) => getCategoryColor({
    id: entry.id,
    name: entry.name,
    kind: entry.categoryKind,
  })
  const getSpacedBreakdownColor = (entry: BreakdownEntry) => breakdownColors.get(entry.id || entry.name)
    ?? getBreakdownColor(entry)
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
    entry: BreakdownEntry | undefined,
    event: ReactMouseEvent<SVGGraphicsElement>,
  ) => {
    if (!entry) {
      setBreakdownTooltipVisible(false)
      return
    }

    updateBreakdownTooltipPosition(event.clientX, event.clientY)
    setHoveredBreakdownEntry((current) => (
      current?.id === entry.id ? current : entry
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
  const legendEntries = useMemo(
    () => getLegendEntries(displaySnapshot.entries, displaySnapshot.mode),
    [displaySnapshot.entries, displaySnapshot.mode],
  )
  const legendMinHeight = getLegendMinHeight(legendEntries.length)

  return (
    <section className="app-card">
      <SectionHeader
        icon={PieChartIcon}
        label={(
          <span className="inline-flex items-center gap-2">
            <span className="inline-flex items-baseline whitespace-nowrap">
              <AppSlotMachineText text={displaySnapshot.mode === 'expense' ? 'Expense' : 'Income'} />
              <span className="ml-[0.25em]">Breakdown</span>
            </span>
            <IconTooltip
              label={`${displaySnapshot.mode === 'expense' ? 'Expense' : 'Income'} breakdown calculation`}
              placement="top"
              widthClassName="w-72"
              size={14}
              strokeWidth={2.25}
            >
              {getBreakdownCalculation(displaySnapshot.mode)}
            </IconTooltip>
            {displaySnapshot.fxStatus && (
              <FxStatusBadge
                label="Income and expense breakdown FX status"
                status={displaySnapshot.fxStatus}
                getMessage={getIncomeExpenseBreakdownFxStatusMessage}
              />
            )}
          </span>
        )}
        action={(
          <InsightActionButton
            title={mode === 'expense' ? 'Show income breakdown' : 'Show expense breakdown'}
            ariaLabel={mode === 'expense' ? 'Show income breakdown' : 'Show expense breakdown'}
            onPress={onModeToggle}
          >
            <Repeat size={12} />
          </InsightActionButton>
        )}
      />
      <div className="relative overflow-visible" data-tooltip-bounds>
        <InsightLoadingContent concealed={contentConcealed} shouldReduceMotion={shouldReduceMotion}>
          <div className="grid gap-6 min-[1350px]:grid-cols-[minmax(0,0.95fr)_minmax(360px,1.05fr)]">
            <div className="flex min-h-[620px] flex-col">
              <div
                ref={breakdownChartRef}
                className="relative h-[450px] shrink-0"
                onMouseLeave={hideBreakdownTooltip}
              >
                <div className="pointer-events-none absolute inset-0 z-10 flex flex-col items-center justify-center">
                  <span className="app-label app-label-compact">
                    Total {displaySnapshot.mode === 'expense' ? 'Expense' : 'Income'}
                  </span>
                  <span className="font-financial text-3xl leading-none tracking-tight">
                    {formatCurrency(displaySnapshot.total, displaySnapshot.displayCurrency)}
                  </span>
                </div>
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={displaySnapshot.entries}
                      cx="50%"
                      cy="50%"
                      innerRadius="62%"
                      outerRadius="90%"
                      paddingAngle={3}
                      dataKey="amount"
                      nameKey="name"
                      stroke="none"
                      onMouseEnter={(_sector, index, event) => {
                        showBreakdownTooltip(displaySnapshot.entries[index], event)
                      }}
                      onMouseMove={(_sector, index, event) => {
                        showBreakdownTooltip(displaySnapshot.entries[index], event)
                      }}
                      onMouseLeave={hideBreakdownTooltip}
                    >
                      {displaySnapshot.entries.map((entry) => (
                        <Cell key={entry.id} fill={getSpacedBreakdownColor(entry)} />
                      ))}
                    </Pie>
                  </PieChart>
                </ResponsiveContainer>
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
                        {renderCrossoverBadge(hoveredBreakdownEntry, displaySnapshot.mode)}
                      </div>
                      <div className="app-chart-tooltip-default-value">
                        {formatCurrency(hoveredBreakdownEntry.amount, displaySnapshot.displayCurrency)}
                      </div>
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
                    key={displaySnapshot.animationKey}
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
                          {renderCrossoverBadge(entry, displaySnapshot.mode)}
                        </span>
                        <span className="font-financial">
                          {getPct(entry.amount, sliceTotal)}%
                        </span>
                      </motion.div>
                    ))}
                  </motion.div>
                </AnimatePresence>
              </div>
            </div>

            <div className="flex min-h-[620px] flex-col border-t border-[var(--app-border)] pt-3 min-[1350px]:border-t-0 min-[1350px]:pt-0">
              <div className="grid gap-4 min-[1350px]:min-h-0 min-[1350px]:flex-1 min-[1350px]:grid-rows-2">
                {displaySnapshot.trendSections.map((section) => (
                  <div
                    key={section.id}
                    className="flex min-h-0 flex-col"
                  >
                    <p className="app-label mb-2 inline-flex items-center gap-2">
                      {section.label}
                      <IconTooltip
                        label={`${section.label} calculation`}
                        placement="top"
                        widthClassName="w-72"
                        size={14}
                        strokeWidth={2.25}
                      >
                        {getTrendSectionCalculation(section.id)}
                      </IconTooltip>
                    </p>
                    <div className="min-h-0 flex-1 overflow-hidden">
                      <AnimatePresence initial={false} mode="wait">
                        <motion.div
                          key={`${section.id}-${displaySnapshot.animationKey}`}
                          className={section.drivers.length === 0 ? 'h-36 min-[1350px]:h-full' : 'space-y-2'}
                          variants={shouldReduceMotion ? undefined : categoryTrendListVariants}
                          initial={shouldReduceMotion ? false : 'initial'}
                          animate={shouldReduceMotion ? { opacity: 1 } : 'enter'}
                          exit={shouldReduceMotion ? undefined : 'exit'}
                        >
                          {section.drivers.length === 0 ? (
                            <motion.p
                              key={`${section.id}-empty`}
                              className="flex h-full items-center justify-center rounded-md border border-[var(--app-border)] px-3 py-2.5 text-sm"
                              style={{ color: 'var(--app-text-muted)' }}
                              variants={shouldReduceMotion ? undefined : pieLegendItemVariants}
                              transition={shouldReduceMotion ? { duration: 0 } : pieLegendItemTransition}
                            >
                              No {section.id === 'increases' ? 'increases' : 'decreases'} in this period.
                            </motion.p>
                          ) : section.drivers.map((driver) => {
                            const changeAmount = driver.amount - driver.previousAmount
                            const driverColor = getCategoryDriverColor(displaySnapshot.mode, changeAmount)
                            const changePctLabel = driver.changePct === null
                              ? null
                              : `(${driver.changePct > 0 ? '+' : ''}${driver.changePct}%)`
                            return (
                              <motion.div
                                key={driver.id}
                                className="grid gap-2 rounded-md border border-[var(--app-border)] px-3 py-2.5 min-[750px]:grid-cols-[minmax(0,1fr)_auto] min-[750px]:items-center min-[750px]:gap-4"
                                variants={shouldReduceMotion ? undefined : pieLegendItemVariants}
                                transition={shouldReduceMotion ? { duration: 0 } : pieLegendItemTransition}
                              >
                                <div className="min-w-0">
                                  <div className="flex items-start justify-between gap-3 min-[750px]:block">
                                    <p className="min-w-0 truncate font-semibold">
                                      {driver.name}
                                    </p>
                                    <p className="shrink-0 font-financial text-base min-[750px]:hidden">
                                      {formatCurrency(driver.amount, displaySnapshot.displayCurrency)}
                                    </p>
                                  </div>
                                  <p className="mt-1 text-sm min-[750px]:hidden" style={{ color: 'var(--app-text-muted)' }}>
                                    {getTransactionCountLabel(driver.transactionCount)}
                                    <span className="px-1.5" aria-hidden>·</span>
                                    Previous {formatCurrency(driver.previousAmount, displaySnapshot.displayCurrency)}
                                  </p>
                                  <p className="hidden text-sm min-[750px]:block" style={{ color: 'var(--app-text-muted)' }}>
                                    {getTransactionCountLabel(driver.transactionCount)} | previous {formatCurrency(driver.previousAmount, displaySnapshot.displayCurrency)}
                                  </p>
                                </div>
                                <div className="flex items-baseline justify-between gap-3 min-[750px]:block min-[750px]:text-right">
                                  <span className="text-xs font-semibold uppercase min-[750px]:hidden" style={{ color: 'var(--app-text-subtle)' }}>
                                    Change
                                  </span>
                                  <p className="hidden font-financial text-base min-[750px]:block">
                                    {formatCurrency(driver.amount, displaySnapshot.displayCurrency)}
                                  </p>
                                  <p className="font-financial text-sm min-[750px]:mt-1" style={{ color: driverColor }}>
                                    {formatSignedCurrency(changeAmount, displaySnapshot.displayCurrency)}
                                    {changePctLabel && (
                                      <>
                                        {' '}
                                        {changePctLabel}
                                      </>
                                    )}
                                    <span className="hidden min-[750px]:inline">
                                      {' '}
                                      {getCategoryDriverDescriptor(changeAmount)}
                                    </span>
                                  </p>
                                </div>
                              </motion.div>
                            )
                          })}
                        </motion.div>
                      </AnimatePresence>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </InsightLoadingContent>

        <InsightLoadingOverlay
          visible={loadingVisible}
          shouldReduceMotion={shouldReduceMotion}
          label="Loading income and expense breakdown"
          className="absolute inset-0 z-10 flex items-center justify-center bg-[var(--app-surface-soft)]"
        />
      </div>
    </section>
  )
}
