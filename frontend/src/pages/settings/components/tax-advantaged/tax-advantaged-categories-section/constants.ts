import type { TaxTreatment } from '@/api/tax-advantaged-categories'

export const CATEGORY_SUMMARY_LABEL_CLASS = 'app-label mb-1 block h-5 truncate leading-5'
export const CATEGORY_SUMMARY_VALUE_CLASS = 'flex h-6 items-center truncate text-[0.9375rem] font-medium leading-6'
export const CATEGORY_FIELD_TRANSITION = {
  duration: 0.1,
  ease: 'easeOut' as const,
}
export const LIMIT_DELETE_BUTTON_TRANSITION = {
  duration: 0.1,
  ease: 'easeOut' as const,
}
export const EASE = [0.25, 0.1, 0.25, 1] as const

export const TAX_TREATMENT_OPTIONS: { value: TaxTreatment; label: string }[] = [
  { value: 'tax_free', label: 'Exempt' },
  { value: 'tax_deferred', label: 'Deferred' },
  { value: 'tax_assisted', label: 'Assisted' },
]

export const DEFAULT_NEW_LIMIT_YEAR = new Date().getFullYear()
export const MAX_VISIBLE_LIMIT_ROWS = 5
export const ACCOUNT_LINK_SAVE_NOTICE_DELAY_MS = 250
export const ACCOUNT_LINK_SAVE_MIN_LOADING_MS = 500
export const LIMIT_SAVE_FEEDBACK_MS = 600
export const LIMIT_DELETE_FEEDBACK_MS = 800
export const CREATE_TAX_CATEGORY_MIN_LOADING_MS = 800
export const DELETE_TAX_CATEGORY_MIN_LOADING_MS = 800
