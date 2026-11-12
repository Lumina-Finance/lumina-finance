import type { AccountKind, AccountType } from '@/api/accounts'

export interface CreateAccountForm {
  account_type: AccountType | ''
  name: string
  currency: string
  institution_id: string
  tax_advantaged_category_id: string
  credit_limit: string
  notes: string
}

export type CreateAccountFormField = keyof CreateAccountForm
export type CreateAccountValidatedField = 'account_type' | 'name' | 'currency' | 'credit_limit' | 'notes'
export type CreateAccountFieldErrors = Partial<Record<CreateAccountValidatedField, string>>
export type ConditionalAccountField = 'tax-plan' | 'credit-limit' | null

export interface CreateAccountViewModel {
  accountKind: AccountKind | undefined
  conditionalAccountField: ConditionalAccountField
  isRevolving: boolean
  selectedAccountTypeLabel: string | undefined
  selectedCurrencySymbol: string
}
