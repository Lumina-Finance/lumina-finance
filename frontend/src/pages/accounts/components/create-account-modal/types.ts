import type { AccountKind, AccountType } from '@/api/accounts'

export interface CreateAccountForm {
  account_type: AccountType | ''
  name: string
  currency: string
  institution_id: string
  tax_advantaged_category_id: string
  credit_limit: string
  starting_balance: string
  notes: string
}

export type CreateAccountFormField = keyof CreateAccountForm
export type CreateAccountValidatedField =
  'account_type' | 'name' | 'currency' | 'credit_limit' | 'starting_balance' | 'notes'
export type CreateAccountFieldErrors = Partial<Record<CreateAccountValidatedField, string>>
export type ConditionalAccountField = 'tax-plan' | 'credit-limit' | null

export interface CreateAccountViewModel {
  accountKind: AccountKind | undefined
  conditionalAccountField: ConditionalAccountField
  isLiability: boolean
  isRevolving: boolean
  selectedAccountTypeLabel: string | undefined
  selectedCurrencySymbol: string
  startingBalanceLabel: string
}
