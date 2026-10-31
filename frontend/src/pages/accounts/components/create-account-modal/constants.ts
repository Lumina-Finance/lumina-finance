import type { DropdownOption } from '@/components/dropdown/Dropdown'
import type {
  CreateAccountForm,
  CreateAccountValidatedField,
} from '@/pages/accounts/components/create-account-modal/types'

export const CREATE_ACCOUNT_EASE = [0.25, 0.1, 0.25, 1] as const

export const CREATE_ACCOUNT_MODAL_FIELD_IDS = {
  accountType: 'account-type',
  name: 'account-name',
  currency: 'account-currency',
  startingBalance: 'starting-balance',
  creditLimit: 'credit-limit',
  institution: 'account-institution',
  taxAdvantagedCategory: 'account-tax-advantaged-category',
} as const

export const CREATE_ACCOUNT_TYPE_OPTIONS: DropdownOption[] = [
  { value: 'checking', label: 'Checking', group: 'Assets' },
  { value: 'savings', label: 'Savings', group: 'Assets' },
  { value: 'term_deposit', label: 'Term deposit', group: 'Assets' },
  { value: 'cash', label: 'Cash', group: 'Assets' },
  { value: 'investment', label: 'Investment', group: 'Assets' },
  { value: 'credit_card', label: 'Credit card', group: 'Revolving credit' },
  { value: 'line_of_credit', label: 'Line of credit', group: 'Revolving credit' },
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

// The validated fields in the order the modal draws them
export const CREATE_ACCOUNT_VALIDATED_FIELDS: readonly CreateAccountValidatedField[] = [
  'account_type',
  'name',
  'currency',
  'starting_balance',
  'credit_limit',
]

// The control that takes focus for each validated field
export const CREATE_ACCOUNT_CONTROL_IDS: Record<CreateAccountValidatedField, string> = {
  account_type: CREATE_ACCOUNT_MODAL_FIELD_IDS.accountType,
  name: CREATE_ACCOUNT_MODAL_FIELD_IDS.name,
  currency: CREATE_ACCOUNT_MODAL_FIELD_IDS.currency,
  starting_balance: CREATE_ACCOUNT_MODAL_FIELD_IDS.startingBalance,
  credit_limit: CREATE_ACCOUNT_MODAL_FIELD_IDS.creditLimit,
}

// The id of each validated field's message, which the field points to as its description
export const CREATE_ACCOUNT_ERROR_IDS: Record<CreateAccountValidatedField, string> = {
  account_type: 'account-type-error',
  name: 'account-name-error',
  currency: 'account-currency-error',
  starting_balance: 'starting-balance-error',
  credit_limit: 'credit-limit-error',
}
