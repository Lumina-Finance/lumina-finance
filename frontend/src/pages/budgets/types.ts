import type React from 'react'
import type { BaseBudget, Budget, RecurrenceFreq } from '@/api/budgets'

export interface BudgetFormState {
  name: string
  currency: string
  categoryIds: string[]
  limit: string
  recurrenceFreq: RecurrenceFreq
  instanceLength: string
  periodStart: string
  recurs: boolean
}

export interface BudgetEditorFieldLabelRowProps {
  label: React.ReactNode
  htmlFor?: string
  error?: string | false
}

/**
 * What the budget details read of a period. The card's latest period and every row of the history
 * both give it
 */
export type BudgetPeriod = Pick<Budget, 'id' | 'period_start' | 'period_end' | 'overall_limit'>

export interface BudgetCardViewModel {
  baseBudget: BaseBudget
  latestPeriod: Budget | undefined
  categoryNames: string[]
}

export interface BudgetFormFieldErrors {
  name?: string
  currency?: string
  limit?: string
  instanceLength?: string
  periodStart?: string
  categoryIds?: string
}
