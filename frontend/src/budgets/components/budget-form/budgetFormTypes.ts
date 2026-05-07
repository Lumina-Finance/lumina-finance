import type React from 'react'
import type { Category } from '@/api/categories'
import type { Currency } from '@/api/currency'
import type { BudgetFormFieldErrors, BudgetFormState } from '@/budgets/types'

export interface BudgetFormViewState {
  form: BudgetFormState
  formError: string | null
  fieldErrors: BudgetFormFieldErrors
  touched: Record<string, boolean>
  categorySearch: string
}

export interface BudgetFormOptions {
  categories: Category[]
  filteredCategories: Category[]
  currencies: Currency[]
}

export interface BudgetFormHandlers {
  onClose: () => void
  onSubmit: (event: React.FormEvent<HTMLFormElement>) => void
  setField: <K extends keyof BudgetFormState>(field: K, value: BudgetFormState[K]) => void
  onRecursChange: (recurs: boolean) => void
  onCategorySearchChange: (value: string) => void
  onCategoryToggle: (categoryId: string) => void
  onBlur: (field: keyof BudgetFormFieldErrors) => void
}

export interface BudgetFormFieldIds {
  name: string
  currency: string
  limit: string
  interval: string
  periodStart: string
  categoryError: string
}

export type BudgetFormErrorGetter = (field: keyof BudgetFormFieldErrors) => string | undefined
