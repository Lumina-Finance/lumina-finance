import type React from 'react'
import type { Category } from '@/api/categories'
import type { Currency } from '@/api/currency'
import type { BudgetFormFieldErrors, BudgetFormState } from '@/budgets/types'

export interface BudgetEditorModalViewState {
  form: BudgetFormState
  formError: string | null
  fieldErrors: BudgetFormFieldErrors
  touched: Record<string, boolean>
  categorySearch: string
}

export interface BudgetEditorModalOptions {
  categories: Category[]
  filteredCategories: Category[]
  currencies: Currency[]
}

export interface BudgetEditorModalHandlers {
  onClose: () => void
  onSubmit: (event: React.FormEvent<HTMLFormElement>) => void
  setField: <K extends keyof BudgetFormState>(field: K, value: BudgetFormState[K]) => void
  onRecursChange: (recurs: boolean) => void
  onCategorySearchChange: (value: string) => void
  onCategoryToggle: (categoryId: string) => void
  onBlur: (field: keyof BudgetFormFieldErrors) => void
}

export interface BudgetEditorModalFieldIds {
  name: string
  currency: string
  limit: string
  interval: string
  periodStart: string
  categoryError: string
}

export type BudgetEditorModalErrorGetter = (field: keyof BudgetFormFieldErrors) => string | undefined
