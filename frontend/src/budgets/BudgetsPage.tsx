import { useCallback, useMemo, useState } from 'react'
import { AnimatePresence } from 'motion/react'
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
import BudgetCardsSection from '@/budgets/components/budget-cards/BudgetCardsSection'
import BudgetCreateModal from '@/budgets/components/budget-form/BudgetCreateModal'
import BudgetDetailsModal from '@/budgets/components/budget-details-modal/BudgetDetailsModal'
import { useBudgetCards } from '@/budgets/hooks/useBudgetCards'
import { useRecurringBudgetBackfill } from '@/budgets/hooks/useRecurringBudgetBackfill'
import type { BudgetCardViewModel } from '@/budgets/types'
import { todayYmd } from '@/budgets/utils/date'

/**
 * Coordinates budget data loading, URL selection, recurring backfill, and modal workflows
 */
export default function BudgetsPage() {
  const { user } = useAuth()
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

  /**
   * Stores a selected-budget snapshot before syncing the detail modal to the URL
   */
  const openBudget = (budget: BudgetCardViewModel) => {
    setBudgetDetailsSnapshot(budget)
    setSearchParams((current) => {
      const next = new URLSearchParams(current)
      next.set('budget', budget.baseBudget.id)
      return next
    })
  }

  /**
   * Clears the selected-budget URL state and any stale details snapshot
   */
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

      <BudgetCardsSection
        budgetCards={budgetCards}
        latestUtilizationByBudgetId={latestUtilizationByBudgetId}
        loading={budgetsLoading}
        error={budgetsError}
        formOptionsLoading={categoriesLoading || currenciesLoading}
        onOpenBudget={openBudget}
      />

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
