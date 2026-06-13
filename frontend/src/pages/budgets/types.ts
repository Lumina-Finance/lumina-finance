
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

export interface CalendarDate {
  year: number
  month: number
  day: number
}

export interface FieldLabelRowProps {
  label: React.ReactNode
  htmlFor?: string
  error?: string | false
}

export interface BudgetCardViewModel {
  baseBudget: BaseBudget
  periods: Budget[]
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
