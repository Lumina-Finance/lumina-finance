import type { DropdownOption } from '@/components/Dropdown'
import type { CreateAccountFieldErrors, CreateAccountForm } from '@/pages/accounts/components/create-account-modal/createAccountModalTypes'

export const CREATE_ACCOUNT_EASE = [0.25, 0.1, 0.25, 1] as const

export const CREATE_ACCOUNT_TYPE_OPTIONS: DropdownOption[] = [
  { value: 'checking', label: 'Checking', group: 'Assets' },
  { value: 'savings', label: 'Savings', group: 'Assets' },
  { value: 'term_deposit', label: 'Term Deposit', group: 'Assets' },
  { value: 'cash', label: 'Cash', group: 'Assets' },
  { value: 'investment', label: 'Investment', group: 'Assets' },
  { value: 'credit_card', label: 'Credit Card', group: 'Revolving credit' },
  { value: 'line_of_credit', label: 'Line of Credit', group: 'Revolving credit' },
  { value: 'heloc', label: 'HELOC', group: 'Revolving credit' },
  { value: 'loan', label: 'Loan', group: 'Amortizing debt' },
  { value: 'mortgage', label: 'Mortgage', group: 'Amortizing debt' },
]

export const INITIAL_CREATE_ACCOUNT_FORM: CreateAccountForm = {
  account_type: '',
  name: '',
  currency: '',
  institution_id: '',
  tax_advantaged_category_id: '',
  credit_limit: '',
  starting_balance: '',
}

export const ALL_CREATE_ACCOUNT_FIELDS_TOUCHED: Record<keyof CreateAccountFieldErrors, boolean> = {
  account_type: true,
  name: true,
  currency: true,
  credit_limit: true,
  starting_balance: true,
}
