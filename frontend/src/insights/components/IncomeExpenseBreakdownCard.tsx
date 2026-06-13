import { useMemo } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { PieChart as PieChartIcon, Repeat } from 'lucide-react'
import type { FxStatus } from '@/api/shared/fx'
import IconTooltip from '@/components/IconTooltip'
import { getIncomeExpenseBreakdownFxStatusMessage } from '@/insights/utils/fxTooltipMessages'
import { formatCurrency } from '@/utils/formatCurrency'
import {
  InsightLoadingContent,
  InsightLoadingOverlay,
} from './InsightLoadingTransition'
import { AppSlotMachineText } from '@/components/AppSlotMachineText'
import { FxStatusBadge } from './FxStatusBadge'
import { InsightActionButton } from './InsightActionButton'
import { IncomeExpensePieChart } from './income-expense/IncomeExpensePieChart'
import { SectionHeader } from './SectionHeader'
import { useInsightLoadingSnapshot } from './useInsightLoadingSnapshot'
import {
  formatSignedBreakdownCurrency,
  getBreakdownCalculation,
  getCategoryDriverColor,
  getCategoryDriverDescriptor,
  getTransactionCountLabel,
  getTrendSectionCalculation,
} from '@/insights/utils/incomeExpenseBreakdownDisplay'
import type {
  BreakdownEntry,
  BreakdownMode,
  CategoryTrendSection,
} from '@/insights/types/incomeExpenseBreakdown'

export type { BreakdownMode } from '@/insights/types/incomeExpenseBreakdown'

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

const pieLegendItemVariants = {
  initial: { opacity: 0, y: 8, filter: 'blur(2px)' },
  enter: { opacity: 1, y: 0, filter: 'blur(0px)' },
  exit: { opacity: 0, y: 8, filter: 'blur(2px)' },
} as const

const pieLegendItemTransition = { duration: 0.24, ease: [0.16, 1, 0.3, 1] } as const

const categoryTrendListVariants = {
  initial: { transition: { staggerChildren: 0.03 } },
  enter: { transition: { staggerChildren: 0.045, delayChildren: 0.03 } },
  exit: { transition: { staggerChildren: 0.035, staggerDirection: -1 } },
} as const

/**
 * Renders the income and expense breakdown card with chart and trend sections
 */
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
            <IncomeExpensePieChart
              mode={displaySnapshot.mode}
              entries={displaySnapshot.entries}
              total={displaySnapshot.total}
              displayCurrency={displaySnapshot.displayCurrency}
              animationKey={displaySnapshot.animationKey}
              shouldReduceMotion={shouldReduceMotion}
            />

            <div className="flex flex-col border-t border-[var(--app-border)] pt-4 min-[1350px]:min-h-[620px] min-[1350px]:border-t-0 min-[1350px]:pt-0">
              <div className="grid gap-5 min-[1350px]:min-h-0 min-[1350px]:flex-1 min-[1350px]:grid-rows-2 min-[1350px]:gap-4">
                {displaySnapshot.trendSections.map((section) => (
                  <div
                    key={section.id}
                    className="flex min-h-0 flex-col"
                  >
                    <p className="app-label mb-3 inline-flex items-center gap-2 min-[1350px]:mb-2">
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
                                    {formatSignedBreakdownCurrency(changeAmount, displaySnapshot.displayCurrency)}
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
