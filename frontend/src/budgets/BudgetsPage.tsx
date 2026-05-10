
import { useCallback, useEffect, useMemo, useState } from 'react'
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
import BudgetCard from '@/budgets/components/budget-card/BudgetCard'
import BudgetCreateModal from '@/budgets/components/budget-form/BudgetCreateModal'
import BudgetDetailsModal from '@/budgets/components/budget-details-modal/BudgetDetailsModal'
import { useBudgetCards } from '@/budgets/hooks/useBudgetCards'
import { useRecurringBudgetBackfill } from '@/budgets/hooks/useRecurringBudgetBackfill'
import type { BudgetCardViewModel } from '@/budgets/types'
import { todayYmd } from '@/budgets/utils/date'

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
  const [selectedBudgetId, setSelectedBudgetId] = useState<string | null>(budgetParam)
  const [budgetDetailsSnapshot, setBudgetDetailsSnapshot] = useState<BudgetCardViewModel | null>(null)
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
  const budgetsLoading = baseBudgetsQuery.isLoading || budgetsQuery.isLoading || latestUtilizationsQuery.isLoading
  const budgetsError = baseBudgetsQuery.isError || budgetsQuery.isError || latestUtilizationsQuery.isError
  const selectedBudget = budgetCards.find(({ baseBudget }) => baseBudget.id === selectedBudgetId)
  const visibleBudgetDetails = selectedBudget ?? (
    budgetDetailsSnapshot?.baseBudget.id === selectedBudgetId ? budgetDetailsSnapshot : null
  )

  // Keep the modal addressable via ?budget= while preserving its last data during refetches.
  useEffect(() => {
    setSelectedBudgetId(budgetParam)
    if (!budgetParam) {
      setBudgetDetailsSnapshot(null)
    }
  }, [budgetParam])

  useEffect(() => {
    if (selectedBudget) {
      setBudgetDetailsSnapshot(selectedBudget)
    }
  }, [selectedBudget])

  const openBudget = (budgetId: string) => {
    setSelectedBudgetId(budgetId)
    setSearchParams((current) => {
      const next = new URLSearchParams(current)
      next.set('budget', budgetId)
      return next
    })
  }

  const closeBudget = () => {
    setSelectedBudgetId(null)
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
      <header className="app-page-header relative min-[750px]:pr-44">
        <h1 className="app-page-title">Budgets</h1>
        <p className="app-page-description">
          Plan ahead and keep your spending in check.
        </p>
        <div className="mt-4 flex min-[750px]:absolute min-[750px]:bottom-0 min-[750px]:right-0 min-[750px]:mt-0 min-[750px]:justify-end">
          <button type="button" className="app-primary-button w-full min-[750px]:w-auto" onClick={() => setCreateOpen(true)}>
            <Plus size={18} aria-hidden />
            New Budget
          </button>
        </div>
      </header>

      {budgetsLoading ? null : budgetsError ? (
        <section className="app-card">
          <p className="text-lg font-semibold" style={{ color: 'var(--app-text)' }}>
            Budgets could not load
          </p>
          <p className="mt-1 text-sm leading-6" style={{ color: 'var(--app-text-subtle)' }}>
            Refresh the page or try again later.
          </p>
        </section>
      ) : budgetCards.length > 0 ? (
        <section className="app-budget-grid">
          {budgetCards.map(({ baseBudget, latestPeriod, categoryNames }) => (
            <BudgetCard
              key={baseBudget.id}
              baseBudget={baseBudget}
              latestPeriod={latestPeriod}
              categoryNames={categoryNames}
              utilization={latestPeriod ? latestUtilizationByBudgetId.get(latestPeriod.id) : undefined}
              onOpen={() => openBudget(baseBudget.id)}
            />
          ))}
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
