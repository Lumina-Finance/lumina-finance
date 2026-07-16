import { useEffect, useRef } from 'react'
import type { CreateBudgetPayload } from '@/api/budgets'
import { ApiError } from '@/api/auth'
import type { BudgetCardViewModel } from '@/pages/budgets/types'
import { missingRecurringPeriodStarts } from '@/pages/budgets/utils/budgetPeriods'

/**
 * Creates elapsed recurring budget periods after stale data loads into the page
 */
export function useRecurringBudgetBackfill({
  enabled,
  budgetCards,
  today,
  createBudgetInstance,
  refetchBudgets,
}: {
  enabled: boolean
  budgetCards: BudgetCardViewModel[]
  today: string
  createBudgetInstance: (payload: CreateBudgetPayload) => Promise<unknown>
  refetchBudgets: () => Promise<unknown>
}) {
  const backfilledKeys = useRef(new Set<string>())

  useEffect(() => {
    if (!enabled) return

    // Remember attempted base/start pairs so rerenders do not duplicate mutation attempts
    const missingPeriods = budgetCards.flatMap(({ baseBudget, latestPeriod }) => {
      if (!latestPeriod) return []

      // Archiving pauses period generation on the backend, so the client must not recreate the skipped periods
      if (baseBudget.is_archived) return []
      return missingRecurringPeriodStarts(baseBudget, latestPeriod, today).map((periodStart) => ({
        key: `${baseBudget.id}:${periodStart}`,
        baseBudgetId: baseBudget.id,
        period_start: periodStart,
        overall_limit: latestPeriod.overall_limit,
      }))
    }).filter((period) => {
      if (backfilledKeys.current.has(period.key)) return false
      backfilledKeys.current.add(period.key)
      return true
    })

    if (missingPeriods.length === 0) return

    let cancelled = false

    /**
     * Runs period creation serially so a failed earlier period does not hide later backend state
     */
    async function backfillPeriods() {
      let shouldRefetch = false
      for (const period of missingPeriods) {
        try {
          await createBudgetInstance({
            baseBudgetId: period.baseBudgetId,
            period_start: period.period_start,
            overall_limit: period.overall_limit,
          })
          shouldRefetch = true
        } catch (error) {

          // A 409 means another request already created the period, so refetch to converge local query data with the backend
          if (error instanceof ApiError && error.status === 409) {
            shouldRefetch = true
            continue
          }
          return
        }
      }

      if (!cancelled && shouldRefetch) {
        await refetchBudgets()
      }
    }

    void backfillPeriods()

    return () => {
      cancelled = true
    }
  }, [budgetCards, createBudgetInstance, enabled, refetchBudgets, today])
}
