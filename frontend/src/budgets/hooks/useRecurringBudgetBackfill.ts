
import { useEffect, useRef } from 'react'
import type { CreateBudgetPayload } from '@/api/budgets'
import { ApiError } from '@/api/auth'
import type { BudgetCardViewModel } from '@/budgets/types'
import { missingRecurringPeriodStarts } from '@/budgets/utils/budgetPeriods'

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

    // Backfill only missing recurring periods up to today, and remember attempted
    // base/start pairs so rerenders do not duplicate mutation attempts.
    const missingPeriods = budgetCards.flatMap(({ baseBudget, latestPeriod }) => {
      if (!latestPeriod) return []
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
          // A 409 means another request already created the period; refetch to
          // converge local query data with the backend.
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
