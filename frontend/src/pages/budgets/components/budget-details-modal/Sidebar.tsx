import { useCallback, useEffect, useRef, useState, type UIEvent } from 'react'
import { Pencil, Trash2, X } from 'lucide-react'
import type { BaseBudget, Budget, BudgetUtilization } from '@/api/budgets'
import { formatCurrency } from '@/utils/formatCurrency'
import MarqueeText from '@/components/display/MarqueeText'
import ScrollableListMoreButton from '@/components/list-controls/MoreButton'
import ArchivedPill from '@/pages/budgets/components/shared/ArchivedPill'
import BudgetAttentionIcon from '@/pages/budgets/components/shared/AttentionIcon'
import BudgetFxStatusBadge from '@/pages/budgets/components/shared/FxStatusBadge'
import { budgetCadenceLabel, formatBudgetPeriod } from '@/pages/budgets/utils/budgetPeriods'
import { getBudgetUtilizationPercent } from '@/pages/budgets/utils/utilization'

type BudgetAttention = {
  label: string
  background: string
  textColor: string
  indicatorColor: string
}

type BudgetDetailsSidebarProps = {
  baseBudget: BaseBudget
  latestPeriod: Budget | undefined
  latestUtilization: BudgetUtilization | undefined
  latestCategories: BudgetUtilization['categories']
  categoryById: Map<string, string>
  categoryColorById: Map<string, string>
  attention: BudgetAttention
  spent: number
  limit: number
  remaining: number
  isOverBudget: boolean
  showStackedCategoryChart: boolean
  confirmDelete: boolean
  deleteError: string | null
  isDeleting: boolean
  onClose: () => void
  onEdit: () => void
  onDelete: () => void
}

/**
 * Renders the budget details sidebar, current-period summary, tracked categories, and destructive actions
 */
export default function BudgetDetailsSidebar({
  baseBudget,
  latestPeriod,
  latestUtilization,
  latestCategories,
  categoryById,
  categoryColorById,
  attention,
  spent,
  limit,
  remaining,
  isOverBudget,
  showStackedCategoryChart,
  confirmDelete,
  deleteError,
  isDeleting,
  onClose,
  onEdit,
  onDelete,
}: BudgetDetailsSidebarProps) {
  const trackedCategoryListRef = useRef<HTMLDivElement | null>(null)
  const [trackedCategoryListScrollable, setTrackedCategoryListScrollable] = useState(false)
  const [trackedCategoryListAtBottom, setTrackedCategoryListAtBottom] = useState(false)
  const showTrackedCategoryListMoreIndicator = trackedCategoryListScrollable && !trackedCategoryListAtBottom
  const utilizationPct = latestPeriod ? Math.round(getBudgetUtilizationPercent(spent, limit)) : null

  /**
   * Recomputes the tracked-category overflow state after responsive layout and category-count changes
   */
  const syncTrackedCategoryListState = useCallback(() => {
    const list = trackedCategoryListRef.current
    if (!list) return
    const isScrollable = list.scrollHeight > list.clientHeight + 4
    const atBottom = list.scrollTop + list.clientHeight >= list.scrollHeight - 4
    setTrackedCategoryListScrollable(isScrollable)
    setTrackedCategoryListAtBottom(!isScrollable || atBottom)
  }, [])

  useEffect(() => {
    const frame = window.requestAnimationFrame(syncTrackedCategoryListState)
    window.addEventListener('resize', syncTrackedCategoryListState)
    return () => {
      window.cancelAnimationFrame(frame)
      window.removeEventListener('resize', syncTrackedCategoryListState)
    }
  }, [baseBudget.id, latestCategories.length, syncTrackedCategoryListState])

  /**
   * Updates the "more" affordance while users scroll the tracked-category list
   */
  function handleTrackedCategoryListScroll(event: UIEvent<HTMLDivElement>) {
    const target = event.currentTarget
    const isScrollable = target.scrollHeight > target.clientHeight + 4
    const atBottom = target.scrollTop + target.clientHeight >= target.scrollHeight - 4
    setTrackedCategoryListScrollable(isScrollable)
    setTrackedCategoryListAtBottom(!isScrollable || atBottom)
  }

  /**
   * Scrolls the tracked-category list by a partial page so the current context remains visible
   */
  function handleTrackedCategoryListMoreClick() {
    setTrackedCategoryListAtBottom(false)
    window.requestAnimationFrame(() => {
      const list = trackedCategoryListRef.current
      if (!list) return
      list.scrollBy({ top: list.clientHeight * 0.45, behavior: 'smooth' })
    })
  }

  return (
    <aside
      className="sticky top-0 z-10 flex shrink-0 flex-col gap-5 p-5 min-[750px]:gap-7 min-[750px]:p-7 min-[1050px]:static min-[1050px]:z-auto min-[1050px]:h-full min-[1050px]:min-h-0 min-[1050px]:shrink min-[1050px]:overflow-hidden"
      style={{ background: 'var(--app-accent-soft)', color: 'var(--app-text)' }}
    >
      <header className="relative shrink-0">
        <div className="min-w-0 w-full">
          <h2 className="pr-11 text-2xl font-semibold min-[1050px]:pr-0">
            <MarqueeText active>{baseBudget.name}</MarqueeText>
          </h2>
          {baseBudget.is_archived ? (
            <ArchivedPill className="mt-2" />
          ) : (
            <span
              className="mt-2 inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-sm font-medium"
              style={{ background: attention.background, color: attention.textColor }}
            >
              <BudgetAttentionIcon label={attention.label} />
              {attention.label}
            </span>
          )}
          <p className="mt-2 min-w-0 truncate text-sm" style={{ color: 'var(--app-text-subtle)' }}>
            {budgetCadenceLabel(baseBudget)} · {baseBudget.group_id ? 'Shared' : 'Personal'} · {baseBudget.currency}
          </p>
        </div>
        <button type="button" className="app-icon-button absolute right-0 top-0 shrink-0 min-[1050px]:hidden" aria-label="Close budget details" onClick={onClose}>
          <X size={20} aria-hidden />
        </button>
      </header>

      <section className="shrink-0">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <p className="text-xs font-semibold uppercase" style={{ color: 'var(--app-text-subtle)' }}>
              Current budget
            </p>
            <BudgetFxStatusBadge
              fxStatus={latestUtilization?.fx_status}
              label="Current budget FX status"
            />
          </div>
        </div>
        {/* An archived budget has no live period, so the current-budget figures do not apply */}
        <div className="mt-2 flex items-baseline gap-2 min-[750px]:mt-3">
          <p className="min-w-0 text-3xl font-semibold leading-none tracking-tight min-[750px]:text-4xl">
            {baseBudget.is_archived ? 'N/A' : latestPeriod ? formatCurrency(Math.abs(remaining), baseBudget.currency) : 'Not set'}
          </p>
          {!baseBudget.is_archived && latestPeriod && (
            <span className="shrink-0 text-base font-bold uppercase min-[750px]:text-lg" style={{ color: 'var(--app-text)' }}>
              {isOverBudget ? 'over' : 'left'}
            </span>
          )}
        </div>
        <p className="mt-3 text-sm" style={{ color: 'var(--app-text-muted)' }}>
          {!latestPeriod
            ? 'No periods have been created yet.'
            : baseBudget.is_archived
              ? `N/A used of ${formatCurrency(limit, baseBudget.currency)}`
              : `${formatCurrency(spent, baseBudget.currency)} used of ${formatCurrency(limit, baseBudget.currency)}`}
        </p>
        {!baseBudget.is_archived && latestPeriod && (
          <div className="mt-4 flex items-center gap-3 min-[750px]:mt-5">
            <div className="h-2 flex-1 rounded-full" style={{ background: 'var(--app-border)' }}>
              <div
                className="h-full rounded-full"
                style={{ width: `${Math.min(Math.max(getBudgetUtilizationPercent(spent, limit), 0), 100)}%`, background: attention.indicatorColor }}
              />
            </div>
            <span className="shrink-0 text-xs font-semibold" style={{ color: 'var(--app-text-subtle)' }}>
              {utilizationPct}% used
            </span>
          </div>
        )}
        {!baseBudget.is_archived && (
          <div className="mt-4 flex justify-between gap-4 border-t pt-3 text-sm min-[750px]:mt-5 min-[750px]:pt-4" style={{ borderColor: 'var(--app-border)' }}>
            <span style={{ color: 'var(--app-text-subtle)' }}>Current period</span>
            <span className="text-right" style={{ color: 'var(--app-text-muted)' }}>
              {latestPeriod ? formatBudgetPeriod(latestPeriod) : 'None'}
            </span>
          </div>
        )}
      </section>

      <section className="border-t pt-6 min-[1050px]:flex min-[1050px]:min-h-0 min-[1050px]:flex-1 min-[1050px]:flex-col" style={{ borderColor: 'var(--app-border)' }}>
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-xs font-semibold uppercase" style={{ color: 'var(--app-text-subtle)' }}>
            Tracked categories
          </h3>
          {latestCategories.length > 0 && (
            <span className="text-xs font-medium" style={{ color: 'var(--app-text-muted)' }}>
              Current period
            </span>
          )}
        </div>
        <div className="relative mt-3 min-[1050px]:min-h-0 min-[1050px]:flex-1">
          <div
            ref={trackedCategoryListRef}
            className="max-h-[15rem] overflow-y-auto pr-2 min-[1050px]:h-full min-[1050px]:max-h-none"
            onScroll={handleTrackedCategoryListScroll}
          >
            {latestCategories.length > 0 ? latestCategories.map((category) => (
              <div
                key={category.category_id}
                className="flex items-center justify-between gap-3 py-2.5 text-sm"
                style={{ borderTop: '1px solid var(--app-border)' }}
              >
                <span className="flex min-w-0 items-center gap-2">
                  {showStackedCategoryChart && (
                    <span
                      className="h-2.5 w-2.5 shrink-0 rounded-full"
                      style={{ background: categoryColorById.get(category.category_id) ?? 'var(--app-border-strong)' }}
                      aria-hidden
                    />
                  )}
                  <span className="truncate" style={{ color: 'var(--app-text-muted)' }}>{categoryById.get(category.category_id) ?? 'Uncategorized'}</span>
                </span>
                <span className="shrink-0 font-medium" style={{ color: 'var(--app-text)' }}>{formatCurrency(category.spent, baseBudget.currency)}</span>
              </div>
            )) : (
              <p className="text-sm" style={{ color: 'var(--app-text-subtle)' }}>
                No category spending for the current period.
              </p>
            )}
          </div>
          <ScrollableListMoreButton
            show={showTrackedCategoryListMoreIndicator}
            onClick={handleTrackedCategoryListMoreClick}
            ariaLabel="Scroll tracked categories down"
          />
        </div>
      </section>

      <div className="shrink-0 min-[1050px]:mt-auto">
        {confirmDelete && !isDeleting && (
          <p className="mb-3 text-sm" style={{ color: 'var(--app-negative)' }}>
            This will delete all historical data.
          </p>
        )}
        {deleteError && (
          <p className="mb-3 text-sm font-medium" style={{ color: 'var(--app-negative)' }}>
            {deleteError}
          </p>
        )}
        <div className="flex gap-3">
          <button type="button" className="app-primary-button flex-1" onClick={onEdit}>
            <Pencil size={16} aria-hidden />
            Edit
          </button>
          <button
            type="button"
            className={`app-danger-button overflow-hidden whitespace-nowrap duration-300 ${isDeleting ? 'app-primary-button-loading shrink-0' : 'flex-1'}`}
            onClick={onDelete}
            disabled={isDeleting}
          >
            {isDeleting ? (
              <div className="app-spinner" />
            ) : (
              <>
                <Trash2 size={16} aria-hidden />
                {confirmDelete ? 'Confirm' : 'Delete'}
              </>
            )}
          </button>
        </div>
      </div>
    </aside>
  )
}
