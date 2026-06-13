import { motion, useReducedMotion } from 'motion/react'
import type { BudgetUtilization } from '@/api/budgets'
import { LoadingOverlay } from '@/components/LoadingTransition'
import BudgetCard from '@/pages/budgets/components/budget-card/BudgetCard'
import type { BudgetCardViewModel } from '@/pages/budgets/types'

const BUDGET_CARDS_LOADING_AREA_HEIGHT = 'max(0px, calc(100dvh - 15rem))'
const BUDGET_CARD_ENTER_OFFSET_PX = 12
const BUDGET_CARD_STAGGER_SECONDS = 0.055

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
          {budgetCards.map((budgetCard, index) => {
            const { baseBudget, latestPeriod, categoryNames } = budgetCard

            return (
              <motion.div
                key={baseBudget.id}
                className="min-w-0"
                initial={shouldReduceMotion ? false : { opacity: 0, y: BUDGET_CARD_ENTER_OFFSET_PX }}
                animate={{ opacity: 1, y: 0 }}
                transition={{
                  duration: shouldReduceMotion ? 0 : 0.24,
                  ease: [0.22, 1, 0.36, 1],
                  delay: shouldReduceMotion ? 0 : index * BUDGET_CARD_STAGGER_SECONDS,
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
