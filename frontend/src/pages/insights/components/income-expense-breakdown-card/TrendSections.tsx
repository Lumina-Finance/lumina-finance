import { AnimatePresence, motion } from 'motion/react'
import { InsightCalculationTooltip } from '@/pages/insights/components/CalculationTooltip'
import type {
  BreakdownMode,
  CategoryTrendSection,
} from '@/pages/insights/types/incomeExpenseBreakdown'
import {
  formatSignedBreakdownCurrency,
  getCategoryDriverColor,
  getCategoryDriverDescriptor,
  getTransactionCountLabel,
  getTrendSectionCalculation,
} from '@/pages/insights/utils/incomeExpenseBreakdownDisplay'
import { formatCurrency } from '@/utils/formatCurrency'

type IncomeExpenseTrendSectionsProps = {
  mode: BreakdownMode
  sections: CategoryTrendSection[]
  displayCurrency: string
  animationKey: string
  shouldReduceMotion: boolean
}

const trendContainerVariants = {
  initial: { transition: { staggerChildren: 0.03 } },
  enter: { transition: { staggerChildren: 0.045, delayChildren: 0.03 } },
  exit: { transition: { staggerChildren: 0.035, staggerDirection: -1 } },
} as const

const trendItemVariants = {
  initial: { opacity: 0, y: 8, filter: 'blur(2px)' },
  enter: { opacity: 1, y: 0, filter: 'blur(0px)' },
  exit: { opacity: 0, y: 8, filter: 'blur(2px)' },
} as const

const trendItemTransition = { duration: 0.24, ease: [0.16, 1, 0.3, 1] } as const

/**
 * Renders category increase and decrease trend sections for the active breakdown mode
 */
export function IncomeExpenseTrendSections({
  mode,
  sections,
  displayCurrency,
  animationKey,
  shouldReduceMotion,
}: IncomeExpenseTrendSectionsProps) {
  return (
    <div className="flex flex-col border-t border-[var(--app-border)] pt-4 min-[1350px]:min-h-[620px] min-[1350px]:border-t-0 min-[1350px]:pt-0">
      <div className="grid gap-5 min-[1350px]:min-h-0 min-[1350px]:flex-1 min-[1350px]:grid-rows-2 min-[1350px]:gap-4">
        {sections.map((section) => (
          <div
            key={section.id}
            className="flex min-h-0 flex-col"
          >
            <p className="app-label mb-3 inline-flex items-center gap-2 min-[1350px]:mb-2">
              {section.label}
              <InsightCalculationTooltip
                label={section.label}
                calculation={getTrendSectionCalculation(section.id)}
              />
            </p>
            <div className="min-h-0 flex-1 overflow-hidden">
              <AnimatePresence initial={false} mode="wait">
                <motion.div
                  key={`${section.id}-${animationKey}`}
                  className={section.drivers.length === 0 ? 'h-36 min-[1350px]:h-full' : 'space-y-2'}
                  variants={shouldReduceMotion ? undefined : trendContainerVariants}
                  initial={shouldReduceMotion ? false : 'initial'}
                  animate={shouldReduceMotion ? { opacity: 1 } : 'enter'}
                  exit={shouldReduceMotion ? undefined : 'exit'}
                >
                  {section.drivers.length === 0 ? (
                    <motion.p
                      key={`${section.id}-empty`}
                      className="flex h-full items-center justify-center rounded-md border border-[var(--app-border)] px-3 py-2.5 text-sm"
                      style={{ color: 'var(--app-text-muted)' }}
                      variants={shouldReduceMotion ? undefined : trendItemVariants}
                      transition={shouldReduceMotion ? { duration: 0 } : trendItemTransition}
                    >
                      No {section.id === 'increases' ? 'increases' : 'decreases'} in this period.
                    </motion.p>
                  ) : section.drivers.map((driver) => {
                    const changeAmount = driver.amount - driver.previousAmount
                    const driverColor = getCategoryDriverColor(mode, changeAmount)
                    const changePctLabel = driver.changePct === null
                      ? null
                      : `(${driver.changePct > 0 ? '+' : ''}${driver.changePct}%)`
                    return (
                      <motion.div
                        key={driver.id}
                        className="grid gap-2 rounded-md border border-[var(--app-border)] px-3 py-2.5 min-[750px]:grid-cols-[minmax(0,1fr)_auto] min-[750px]:items-center min-[750px]:gap-4"
                        variants={shouldReduceMotion ? undefined : trendItemVariants}
                        transition={shouldReduceMotion ? { duration: 0 } : trendItemTransition}
                      >
                        <div className="min-w-0">
                          <div className="flex items-start justify-between gap-3 min-[750px]:block">
                            <p className="min-w-0 truncate font-semibold">
                              {driver.name}
                            </p>
                            <p className="shrink-0 font-financial text-base min-[750px]:hidden">
                              {formatCurrency(driver.amount, displayCurrency)}
                            </p>
                          </div>
                          <p className="mt-1 text-sm min-[750px]:hidden" style={{ color: 'var(--app-text-muted)' }}>
                            {getTransactionCountLabel(driver.transactionCount)}
                            <span className="px-1.5" aria-hidden>·</span>
                            Previous {formatCurrency(driver.previousAmount, displayCurrency)}
                          </p>
                          <p className="hidden text-sm min-[750px]:block" style={{ color: 'var(--app-text-muted)' }}>
                            {getTransactionCountLabel(driver.transactionCount)} | previous {formatCurrency(driver.previousAmount, displayCurrency)}
                          </p>
                        </div>
                        <div className="flex items-baseline justify-between gap-3 min-[750px]:block min-[750px]:text-right">
                          <span className="text-xs font-semibold uppercase min-[750px]:hidden" style={{ color: 'var(--app-text-subtle)' }}>
                            Change
                          </span>
                          <p className="hidden font-financial text-base min-[750px]:block">
                            {formatCurrency(driver.amount, displayCurrency)}
                          </p>
                          <p className="font-financial text-sm min-[750px]:mt-1" style={{ color: driverColor }}>
                            {formatSignedBreakdownCurrency(changeAmount, displayCurrency)}
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
  )
}
