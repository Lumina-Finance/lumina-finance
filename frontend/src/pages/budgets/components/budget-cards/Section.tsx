import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import type { BudgetUtilization } from '@/api/budgets'
import { LoadingOverlay } from '@/components/loading/Transition'
import BudgetCard from '@/pages/budgets/components/budget-card/Card'
import { EASE } from '@/pages/budgets/constants'
import type { BudgetCardViewModel } from '@/pages/budgets/types'

const BUDGET_CARDS_LOADING_AREA_HEIGHT = 'max(0px, calc(100dvh - 15rem))'
const BUDGET_CARD_ENTER_OFFSET_PX = 12
const BUDGET_CARD_STAGGER_SECONDS = 0.055
const BUDGET_CARD_ENTER_SECONDS = 0.24
const BUDGET_CARD_ENTER_EASE = [0.22, 1, 0.36, 1] as const

// Archiving on save removes a card from the active list, so it fades and shrinks out while the grid reflows
const BUDGET_CARD_EXIT_SCALE = 0.92
const BUDGET_CARD_EXIT_SECONDS = 0.2
const BUDGET_CARD_REFLOW_SECONDS = 0.28

type BudgetCardsSectionProps = {
  budgetCards: BudgetCardViewModel[]
  latestUtilizationByBudgetId: Map<string, BudgetUtilization>
  loading: boolean
  error: boolean
  formOptionsLoading: boolean
  onOpenBudget: (budget: BudgetCardViewModel) => void
}

type BudgetCardsLoadingLayerProps = {
  visible: boolean
  shouldReduceMotion: boolean
  fill?: boolean
}

/**
 * Renders the budget card grid and the loading, error, and empty states for the page
 */
export default function BudgetCardsSection({
  budgetCards,
  latestUtilizationByBudgetId,
  loading,
  error,
  formOptionsLoading,
  onOpenBudget,
}: BudgetCardsSectionProps) {
  const shouldReduceMotion = useReducedMotion() ?? false

  if (error && budgetCards.length === 0) {
    return (
      <section className="app-card">
        <p className="text-lg font-semibold" style={{ color: 'var(--app-text)' }}>
          Budgets could not load
        </p>
        <p className="mt-1 text-sm leading-6" style={{ color: 'var(--app-text-subtle)' }}>
          Refresh the page or try again later.
        </p>
      </section>
    )
  }

  if (budgetCards.length > 0) {
    return (
      <section className="relative" aria-busy={loading}>
        <section className="app-budget-grid">
          {/* popLayout pulls the exiting card out of layout flow immediately so the remaining cards reflow during its exit instead of after it unmounts */}
          <AnimatePresence mode="popLayout">
            {budgetCards.map((budgetCard, index) => {
              const { baseBudget, latestPeriod, categoryNames } = budgetCard

              return (
                <motion.div
                  key={baseBudget.id}
                  layout
                  className="min-w-0"
                  initial={shouldReduceMotion ? false : { opacity: 0, y: BUDGET_CARD_ENTER_OFFSET_PX }}
                  animate={{
                    opacity: 1,
                    y: 0,
                    transition: {
                      duration: shouldReduceMotion ? 0 : BUDGET_CARD_ENTER_SECONDS,
                      ease: BUDGET_CARD_ENTER_EASE,
                      delay: shouldReduceMotion ? 0 : index * BUDGET_CARD_STAGGER_SECONDS,
                    },
                  }}
                  exit={shouldReduceMotion ? { opacity: 0 } : { opacity: 0, scale: BUDGET_CARD_EXIT_SCALE }}
                  transition={{
                    duration: shouldReduceMotion ? 0 : BUDGET_CARD_EXIT_SECONDS,
                    ease: EASE,
                    layout: { duration: shouldReduceMotion ? 0 : BUDGET_CARD_REFLOW_SECONDS, ease: EASE },
                  }}
                >
                  <BudgetCard
                    baseBudget={baseBudget}
                    latestPeriod={latestPeriod}
                    categoryNames={categoryNames}
                    utilization={latestPeriod ? latestUtilizationByBudgetId.get(latestPeriod.id) : undefined}
                    onOpen={() => onOpenBudget(budgetCard)}
                  />
                </motion.div>
              )
            })}
          </AnimatePresence>
        </section>
        <BudgetCardsLoadingLayer
          visible={loading}
          shouldReduceMotion={shouldReduceMotion}
        />
      </section>
    )
  }

  if (loading) {
    return (
      <section
        className="relative overflow-hidden rounded-lg"
        style={{ height: BUDGET_CARDS_LOADING_AREA_HEIGHT }}
        aria-busy
      >
        <BudgetCardsLoadingLayer
          visible
          fill
          shouldReduceMotion={shouldReduceMotion}
        />
      </section>
    )
  }

  return (
    <section className="flex min-h-[calc(100vh-16rem)] items-center justify-center text-center italic text-sm" style={{ color: 'var(--app-text-subtle)' }}>
      <div>
        <p>
          No budgets to display
        </p>
        <p className="mt-1">
          Create a budget to start tracking limits, spending, and category progress.
        </p>
      </div>
      {formOptionsLoading && (
        <p className="sr-only">
          Loading form options...
        </p>
      )}
    </section>
  )
}

/**
 * Uses the shared loading overlay while preserving the budget grid's custom placeholder height
 */
function BudgetCardsLoadingLayer({
  visible,
  shouldReduceMotion,
  fill = false,
}: BudgetCardsLoadingLayerProps) {
  return (
    <LoadingOverlay
      visible={visible}
      shouldReduceMotion={shouldReduceMotion}
      label="Loading budgets"
      className={[
        'z-10 flex items-center justify-center overflow-hidden rounded-lg bg-[var(--app-bg)]',
        fill ? 'absolute inset-0' : 'absolute inset-x-0 top-0',
      ].join(' ')}
      style={fill ? undefined : { height: BUDGET_CARDS_LOADING_AREA_HEIGHT }}
    />
  )
}
