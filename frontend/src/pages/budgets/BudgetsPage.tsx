import { useCallback, useMemo, useState } from 'react'
import { AnimatePresence } from 'motion/react'
import { Plus } from 'lucide-react'
import { useSearchParams } from 'react-router'
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
import { useCurrencyGuard } from '@/hooks/useCurrencyGuard'
import BudgetCardsSection from '@/pages/budgets/components/budget-cards/Section'
import BudgetArchivedSection from '@/pages/budgets/components/budget-cards/ArchivedSection'
import BudgetCreateModal from '@/pages/budgets/components/budget-editor-modal/CreateModal'
import BudgetDetailsModal from '@/pages/budgets/components/budget-details-modal/Modal'
import { useBudgetCards } from '@/pages/budgets/hooks/useBudgetCards'
import { useRecurringBudgetBackfill } from '@/pages/budgets/hooks/useRecurringBudgetBackfill'
import type { BudgetCardViewModel } from '@/pages/budgets/types'
import { getTodayYmd, resolveTimeZone } from '@/utils/date'

/**
 * Coordinates budget data loading, URL selection, recurring backfill, and modal workflows
 */
export default function BudgetsPage() {
  const { user } = useAuth()
  const [searchParams, setSearchParams] = useSearchParams()
  const { data: categories, isLoading: categoriesLoading } = useCategories()
  const { data: currencies } = useCurrencies()
  const baseBudgetsQuery = useBaseBudgets()
  const budgetsQuery = useBudgets()
  const latestUtilizationsQuery = useLatestBudgetUtilizations()
  const createBackfillBudget = useCreateBudgetInstance()
  const requireCurrencies = useCurrencyGuard()
  const [createOpen, setCreateOpen] = useState(false)
  const budgetParam = searchParams.get('budget')
  const [budgetDetailsSnapshot, setBudgetDetailsSnapshot] = useState<BudgetCardViewModel | null>(null)
  const selectedBudgetId = budgetParam
  const defaultCurrency = user?.base_currency ?? currencies?.[0]?.id ?? 'USD'
  const userTimeZone = resolveTimeZone(user?.tz)
  const today = useMemo(() => getTodayYmd(userTimeZone), [userTimeZone])
  const categoryById = useMemo(
    () => new Map((categories ?? []).map((category) => [category.id, category.name])),
    [categories],
  )
  const budgetCards = useBudgetCards({
    baseBudgets: baseBudgetsQuery.data,
    periods: budgetsQuery.data,
    categoryById,
  })
  const activeBudgetCards = useMemo(
    () => budgetCards.filter((card) => !card.baseBudget.is_archived),
    [budgetCards],
  )
  const archivedBudgetCards = useMemo(
    () => budgetCards.filter((card) => card.baseBudget.is_archived),
    [budgetCards],
  )
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
  // The snapshot is what stays mounted while the panel animates out, after the URL has already dropped the
  // selection, so the contents do not vanish mid-exit
  const detailsBudget = visibleBudgetDetails ?? budgetDetailsSnapshot

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
   * Clears the selected-budget URL state, leaving the snapshot for the panel's exit to drop
   */
  const closeBudget = () => {
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
    // Wait for both budget queries to settle so backfill never acts on the stale pre-archive periods that
    // linger between an unarchive and its refetch, which would otherwise recreate the suppressed gap periods
    enabled:
      Boolean(user)
      && !baseBudgetsQuery.isFetching
      && !budgetsQuery.isFetching,
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
        <button type="button" className="app-primary-button w-full min-[750px]:w-auto" onClick={() => requireCurrencies(() => setCreateOpen(true))}>
          <Plus size={18} aria-hidden />
          New Budget
        </button>
      </div>

      <BudgetCardsSection
        budgetCards={activeBudgetCards}
        latestUtilizationByBudgetId={latestUtilizationByBudgetId}
        loading={budgetsLoading}
        error={budgetsError}
        formOptionsLoading={categoriesLoading}
        onOpenBudget={openBudget}
      />

      <AnimatePresence initial={false}>
        {archivedBudgetCards.length > 0 && (
          <BudgetArchivedSection
            budgetCards={archivedBudgetCards}
            latestUtilizationByBudgetId={latestUtilizationByBudgetId}
            onOpenBudget={openBudget}
          />
        )}
      </AnimatePresence>

      {/* The New Budget button refuses the click while the currency table is missing, so this only ever
          opens with the table in hand */}
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

      {/* Opens without the currency table, since everything the details view shows comes from the budget
          itself. Only the editor nested inside needs the table, and it stands its limit down instead. The
          snapshot outlives the URL change, so it also keeps the panel's contents in place while it leaves */}
      {detailsBudget && (
        <BudgetDetailsModal
          key={detailsBudget.baseBudget.id}
          open={Boolean(visibleBudgetDetails)}
          baseBudget={detailsBudget.baseBudget}
          periods={detailsBudget.periods}
          categories={categories ?? []}
          currencies={currencies ?? []}
          categoryById={categoryById}
          initialLatestUtilization={
            detailsBudget.latestPeriod
              ? latestUtilizationByBudgetId.get(detailsBudget.latestPeriod.id)
              : undefined
          }
          today={today}
          onClose={closeBudget}
          onExitComplete={() => setBudgetDetailsSnapshot(null)}
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
    </div>
  )
}
