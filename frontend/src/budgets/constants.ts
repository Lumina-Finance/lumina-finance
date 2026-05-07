
import type { RecurrenceFreq } from '@/api/budgets'

export const RECURRENCE_OPTIONS: Array<{ value: RecurrenceFreq; label: string }> = [
  { value: 'weekly', label: 'Weekly' },
  { value: 'monthly', label: 'Monthly' },
  { value: 'yearly', label: 'Yearly' },
]

export const EASE = [0.25, 0.1, 0.25, 1] as const
export const MODAL_SURFACE_TRANSITION_SECONDS = 0.25
export const MODAL_SURFACE_TRANSITION_MS = MODAL_SURFACE_TRANSITION_SECONDS * 1000
export const CREATE_BUDGET_MIN_LOADING_MS = 800
export const DELETE_BUDGET_MIN_LOADING_MS = 1000
export const DEFAULT_CATEGORY_ICON = '🏷️'
