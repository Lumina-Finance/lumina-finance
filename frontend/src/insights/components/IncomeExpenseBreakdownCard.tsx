import { useMemo, type ReactNode } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import {
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
} from 'recharts'
import { formatCurrency } from '@/utils/formatCurrency'
import {
  InsightLoadingContent,
  InsightLoadingOverlay,
} from './InsightLoadingTransition'
import { useInsightLoadingSnapshot } from './useInsightLoadingSnapshot'

export type BreakdownMode = 'expense' | 'income'

export type BreakdownEntry = {
  id: string
  name: string
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
  header: ReactNode
  mode: BreakdownMode
  entries: BreakdownEntry[]
  trendSections: CategoryTrendSection[]
  displayCurrency: string
  animationKey: string
  loading?: boolean
  transitionKey: string
}

type IncomeExpenseBreakdownSnapshot = {
  mode: BreakdownMode
  entries: BreakdownEntry[]
  trendSections: CategoryTrendSection[]
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

const insightsBreakdownColors = [
  '#C9A96A',
  'var(--app-chart-positive)',
  '#D4906A',
  '#9B8FC8',
  'var(--app-chart-negative)',
  '#7AAEC8',
  '#8C8074',
] as const

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

export function IncomeExpenseBreakdownCard({
  header,
  mode,
  entries,
  trendSections,
  displayCurrency,
  animationKey,
  loading = false,
  transitionKey,
}: IncomeExpenseBreakdownCardProps) {
  const incomingSnapshot = useMemo<IncomeExpenseBreakdownSnapshot>(() => ({
    mode,
    entries,
    trendSections,
    displayCurrency,
    animationKey,
  }), [animationKey, displayCurrency, entries, mode, trendSections])
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
  const total = getTotal(displaySnapshot.entries)

  return (
    <section className="app-card">
      {header}
      <div className="relative overflow-hidden">
        <InsightLoadingContent concealed={contentConcealed} shouldReduceMotion={shouldReduceMotion}>
          <div className="grid gap-6 min-[1350px]:grid-cols-[minmax(0,0.95fr)_minmax(360px,1.05fr)]">
            <div className="flex min-h-[620px] flex-col">
              <div className="relative h-[450px] shrink-0">
                <div className="pointer-events-none absolute inset-0 z-10 flex flex-col items-center justify-center">
                  <span className="app-label app-label-compact">
                    Total {displaySnapshot.mode === 'expense' ? 'Expense' : 'Income'}
                  </span>
                  <span className="font-financial text-3xl leading-none tracking-tight">
                    {formatCurrency(total, displaySnapshot.displayCurrency)}
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
                    >
                      {displaySnapshot.entries.map((entry, index) => (
                        <Cell key={entry.id} fill={insightsBreakdownColors[index % insightsBreakdownColors.length]} />
                      ))}
                    </Pie>
                    <Tooltip
                      wrapperClassName="app-chart-tooltip-default"
                      formatter={(value, name) => [formatCurrency(Number(value), displaySnapshot.displayCurrency), name]}
                    />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div className="relative mt-auto min-h-[136px] overflow-hidden">
                <AnimatePresence initial={false} mode="wait">
                  <motion.div
                    key={displaySnapshot.animationKey}
                    className="absolute inset-x-5 bottom-0 space-y-2"
                    variants={shouldReduceMotion ? undefined : pieLegendContainerVariants}
                    initial={shouldReduceMotion ? false : 'initial'}
                    animate={shouldReduceMotion ? { opacity: 1 } : 'enter'}
                    exit={shouldReduceMotion ? undefined : 'exit'}
                  >
                    {displaySnapshot.entries.slice(0, 5).map((entry, index) => (
                      <motion.div
                        key={entry.id}
                        className="flex items-center gap-3 text-sm"
                        variants={shouldReduceMotion ? undefined : pieLegendItemVariants}
                        transition={shouldReduceMotion ? { duration: 0 } : pieLegendItemTransition}
                      >
                        <span
                          className="h-2.5 w-2.5 rounded-full"
                          style={{ background: insightsBreakdownColors[index % insightsBreakdownColors.length] }}
                        />
                        <span className="min-w-0 flex-1 truncate" style={{ color: 'var(--app-text-muted)' }}>
                          {entry.name}
                        </span>
                        <span className="font-financial">
                          {getPct(entry.amount, total)}%
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
                    <p className="app-label mb-2">
                      {section.label}
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
                                className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4 rounded-md border border-[var(--app-border)] px-3 py-2.5"
                                variants={shouldReduceMotion ? undefined : pieLegendItemVariants}
                                transition={shouldReduceMotion ? { duration: 0 } : pieLegendItemTransition}
                              >
                                <div className="min-w-0">
                                  <p className="truncate font-semibold">
                                    {driver.name}
                                  </p>
                                  <p className="text-sm" style={{ color: 'var(--app-text-muted)' }}>
                                    {driver.transactionCount} transactions | previous {formatCurrency(driver.previousAmount, displaySnapshot.displayCurrency)}
                                  </p>
                                </div>
                                <div className="text-right">
                                  <p className="font-financial text-base">
                                    {formatCurrency(driver.amount, displaySnapshot.displayCurrency)}
                                  </p>
                                  <p className="mt-1 font-financial text-sm" style={{ color: driverColor }}>
                                    {formatSignedCurrency(changeAmount, displaySnapshot.displayCurrency)}
                                    {changePctLabel && (
                                      <>
                                        {' '}
                                        {changePctLabel}
                                      </>
                                    )}
                                    {' '}
                                    {getCategoryDriverDescriptor(changeAmount)}
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
