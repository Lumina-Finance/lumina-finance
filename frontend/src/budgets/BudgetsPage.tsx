
import { useCallback, useMemo, useState } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { Plus } from 'lucide-react'
import { useSearchParams } from 'react-router-dom'
import {
  useBaseBudgets,
  useBudgets,
  useCreateBudgetInstance,
  useLatestBudgetUtilizations,
  type CreateBudgetPayload,
} from '@/api/budgets'
import { useCategories } from '@/api/categories'
import { useCurrencies } from '@/api/currency'
import { useAuth } from '@/hooks/useAuth'
import BudgetCard from '@/budgets/components/budget-card/BudgetCard'
import BudgetCreateModal from '@/budgets/components/budget-form/BudgetCreateModal'
import BudgetDetailsModal from '@/budgets/components/budget-details-modal/BudgetDetailsModal'
import { useBudgetCards } from '@/budgets/hooks/useBudgetCards'
import { useRecurringBudgetBackfill } from '@/budgets/hooks/useRecurringBudgetBackfill'
import type { BudgetCardViewModel } from '@/budgets/types'
import { todayYmd } from '@/budgets/utils/date'

const BUDGET_CARDS_LOADING_AREA_HEIGHT = 'max(0px, calc(100dvh - 15rem))'
const BUDGET_CARDS_LOADING_TRANSITION = { duration: 0.32, ease: [0.22, 1, 0.36, 1] } as const
const BUDGET_CARD_ENTER_OFFSET_PX = 12
const BUDGET_CARD_STAGGER_SECONDS = 0.055

function BudgetCardsLoadingLayer({
  visible,
  fill = false,
}: {
  visible: boolean
  fill?: boolean
}) {
  const shouldReduceMotion = useReducedMotion() ?? false

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          className={[
            'z-10 flex items-center justify-center overflow-hidden rounded-lg bg-[var(--app-bg)]',
            fill ? 'absolute inset-0' : 'absolute inset-x-0 top-0',
          ].join(' ')}
          style={fill ? undefined : { height: BUDGET_CARDS_LOADING_AREA_HEIGHT }}
          initial={shouldReduceMotion ? false : { opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={shouldReduceMotion ? { duration: 0 } : BUDGET_CARDS_LOADING_TRANSITION}
        >
          <div className="app-spinner" aria-label="Loading budgets" />
        </motion.div>
      )}
    </AnimatePresence>
  )
}

export default function BudgetsPage() {
  const { user } = useAuth()
  const shouldReduceMotion = useReducedMotion() ?? false
  const [searchParams, setSearchParams] = useSearchParams()
  const { data: categories, isLoading: categoriesLoading } = useCategories()
  const { data: currencies, isLoading: currenciesLoading } = useCurrencies()
  const baseBudgetsQuery = useBaseBudgets()
  const budgetsQuery = useBudgets()
  const latestUtilizationsQuery = useLatestBudgetUtilizations()
  const createBackfillBudget = useCreateBudgetInstance()
  const [createOpen, setCreateOpen] = useState(false)
  const budgetParam = searchParams.get('budget')
  const [budgetDetailsSnapshot, setBudgetDetailsSnapshot] = useState<BudgetCardViewModel | null>(null)
  const selectedBudgetId = budgetParam
  const defaultCurrency = user?.base_currency ?? currencies?.[0]?.id ?? 'USD'
  const userTimeZone = user?.tz ?? Intl.DateTimeFormat().resolvedOptions().timeZone
  const today = useMemo(() => todayYmd(userTimeZone), [userTimeZone])
  const categoryById = useMemo(
    () => new Map((categories ?? []).map((category) => [category.id, category.name])),
    [categories],
  )
  const budgetCards = useBudgetCards({
    baseBudgets: baseBudgetsQuery.data,
    periods: budgetsQuery.data,
    categoryById,
  })
  const latestUtilizationByBudgetId = useMemo(
    () => new Map(
      (latestUtilizationsQuery.data ?? [])
        .map((utilization) => [utilization.budget_id, utilization]),
    ),
    [latestUtilizationsQuery.data],
  )
  const budgetsLoading = baseBudgetsQuery.isFetching || budgetsQuery.isFetching || latestUtilizationsQuery.isFetching
  const budgetsError = baseBudgetsQuery.isError || budgetsQuery.isError || latestUtilizationsQuery.isError
  const selectedBudget = budgetCards.find(({ baseBudget }) => baseBudget.id === selectedBudgetId)
  const visibleBudgetDetails = selectedBudget ?? (
    budgetDetailsSnapshot?.baseBudget.id === selectedBudgetId ? budgetDetailsSnapshot : null
  )

  const openBudget = (budget: BudgetCardViewModel) => {
    setBudgetDetailsSnapshot(budget)
    setSearchParams((current) => {
      const next = new URLSearchParams(current)
      next.set('budget', budget.baseBudget.id)
      return next
    })
  }

  const closeBudget = () => {
    setBudgetDetailsSnapshot(null)
    setSearchParams((current) => {
      const next = new URLSearchParams(current)
      next.delete('budget')
      return next
    })
  }

  const createBudgetInstance = useCallback(
    (payload: CreateBudgetPayload) => createBackfillBudget.mutateAsync(payload),
    [createBackfillBudget],
  )
  const refetchBudgets = useCallback(() => budgetsQuery.refetch(), [budgetsQuery])

  useRecurringBudgetBackfill({
    enabled: Boolean(user) && !baseBudgetsQuery.isLoading && !budgetsQuery.isLoading,
    budgetCards,
    today,
    createBudgetInstance,
    refetchBudgets,
  })

  return (
    <div>
      <div className="mb-6 flex flex-col gap-4 min-[750px]:flex-row min-[750px]:items-end min-[750px]:justify-between">
        <header className="app-page-header mb-0 min-w-0">
          <h1 className="app-page-title">Budgets</h1>
          <p className="app-page-description">
            Plan ahead and keep your spending in check.
          </p>
        </header>
        <button type="button" className="app-primary-button w-full min-[750px]:w-auto" onClick={() => setCreateOpen(true)}>
          <Plus size={18} aria-hidden />
          New Budget
        </button>
      </div>

      {budgetsError && budgetCards.length === 0 ? (
        <section className="app-card">
          <p className="text-lg font-semibold" style={{ color: 'var(--app-text)' }}>
            Budgets could not load
          </p>
          <p className="mt-1 text-sm leading-6" style={{ color: 'var(--app-text-subtle)' }}>
            Refresh the page or try again later.
          </p>
        </section>
      ) : budgetCards.length > 0 ? (
        <section className="relative" aria-busy={budgetsLoading}>
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
                    onOpen={() => openBudget(budgetCard)}
                  />
                </motion.div>
              )
            })}
          </section>
          <BudgetCardsLoadingLayer visible={budgetsLoading} />
        </section>
      ) : budgetsLoading ? (
        <section
          className="relative overflow-hidden rounded-lg"
          style={{ height: BUDGET_CARDS_LOADING_AREA_HEIGHT }}
          aria-busy
        >
          <BudgetCardsLoadingLayer visible fill />
        </section>
      ) : (
        <section className="flex min-h-[calc(100vh-16rem)] items-center justify-center text-center italic text-sm" style={{ color: 'var(--app-text-subtle)' }}>
          <div>
            <p>
              No budgets to display
            </p>
            <p className="mt-1">
              Create a budget to start tracking limits, spending, and category progress.
            </p>
          </div>
          {(categoriesLoading || currenciesLoading) && (
            <p className="sr-only">
              Loading form options...
            </p>
          )}
        </section>
      )}

      <BudgetCreateModal
        key={`${defaultCurrency}-${userTimeZone}`}
        open={createOpen}
        categories={categories ?? []}
        currencies={currencies ?? []}
        defaultCurrency={defaultCurrency}
        timeZone={userTimeZone}
        onClose={() => setCreateOpen(false)}
        onCreated={() => undefined}
      />

      <AnimatePresence>
        {visibleBudgetDetails && (
          <BudgetDetailsModal
            key={visibleBudgetDetails.baseBudget.id}
            baseBudget={visibleBudgetDetails.baseBudget}
            periods={visibleBudgetDetails.periods}
            categories={categories ?? []}
            currencies={currencies ?? []}
            categoryById={categoryById}
            initialLatestUtilization={
              visibleBudgetDetails.latestPeriod
                ? latestUtilizationByBudgetId.get(visibleBudgetDetails.latestPeriod.id)
                : undefined
            }
            onClose={closeBudget}
            onDeleted={() => {
              void baseBudgetsQuery.refetch()
              void budgetsQuery.refetch()
              void latestUtilizationsQuery.refetch()
            }}
            onSaved={() => {
              void baseBudgetsQuery.refetch()
              void budgetsQuery.refetch()
              void latestUtilizationsQuery.refetch()
            }}
          />
        )}
      </AnimatePresence>
    </div>
  )
}
