import { ACCOUNT_KIND_BY_TYPE, type AccountType, type CreateAccountPayload } from '@/api/accounts'
import type { Currency } from '@/api/currency'
import { CREATE_ACCOUNT_TYPE_OPTIONS, INITIAL_CREATE_ACCOUNT_FORM } from '@/pages/accounts/components/create-account-modal/constants'
import { optionalAccountMoneyInputToMinorUnits } from '@/pages/accounts/components/create-account-modal/utils/money'
import { isValidMoneyInput } from '@/utils/moneyInput'
import type {
  CreateAccountFieldErrors,
  CreateAccountForm,
  CreateAccountFormField,
  CreateAccountViewModel,
} from '@/pages/accounts/components/create-account-modal/types'

/**
 * Seeds the create-account form with the user's base currency while preserving controlled input defaults
 */
export function buildInitialCreateAccountForm(baseCurrency: string | null | undefined): CreateAccountForm {
  return {
    ...INITIAL_CREATE_ACCOUNT_FORM,
    currency: baseCurrency ?? '',
  }
}

/**
 * Applies field updates and clears dependent fields that are no longer valid for the selected account type or currency
 */
export function getNextCreateAccountForm(
  form: CreateAccountForm,
  field: CreateAccountFormField,
  value: string,
): CreateAccountForm {
  const next = { ...form, [field]: value }

  if (field === 'account_type') {
    const nextKind = value ? ACCOUNT_KIND_BY_TYPE[value as AccountType] : undefined
    if (nextKind !== 'revolving') next.credit_limit = ''
    if (nextKind !== 'asset') next.tax_advantaged_category_id = ''
  }

  if (field === 'currency') {
    next.tax_advantaged_category_id = ''
  }

  return next
}

/**
 * Validates user-editable create-account fields before building the backend payload
 */
export function validateCreateAccountForm(form: CreateAccountForm): CreateAccountFieldErrors {
  const errors: CreateAccountFieldErrors = {}

  if (!form.account_type) errors.account_type = 'Select an account type'
  if (!form.name.trim()) {
    errors.name = 'Name is required'
  } else if (form.name.trim().length > 256) {
    errors.name = 'Name must be 256 characters or less'
  }
  if (!form.currency) errors.currency = 'Select a currency'

  if (!isValidMoneyInput(form.credit_limit)) errors.credit_limit = 'Must be a positive number'
  if (!isValidMoneyInput(form.starting_balance)) errors.starting_balance = 'Must be zero or higher'

  return errors
}

/**
 * Derives labels and account-kind flags that drive conditional create-account fields
 */
export function buildCreateAccountViewModel(form: CreateAccountForm, currencies: Currency[]): CreateAccountViewModel {
  const accountKind = form.account_type ? ACCOUNT_KIND_BY_TYPE[form.account_type] : undefined
  const isRevolving = accountKind === 'revolving'
  const isLiability = accountKind === 'revolving' || accountKind === 'amortizing'
  const canLinkTaxPlan = accountKind === 'asset' && !!form.currency

  return {
    accountKind,
    conditionalAccountField: canLinkTaxPlan ? 'tax-plan' : isRevolving ? 'credit-limit' : null,
    isLiability,
    isRevolving,
    selectedAccountTypeLabel: CREATE_ACCOUNT_TYPE_OPTIONS.find((option) => option.value === form.account_type)?.label,
    selectedCurrencySymbol: currencies.find((currency) => currency.id === form.currency)?.symbol ?? '',
    startingBalanceLabel: isLiability ? 'Starting Amount Owed' : 'Starting Balance',
  }
}

/**
 * Converts a validated create-account form into the backend payload while keeping liability balances signed
 */
export function buildCreateAccountPayload(form: CreateAccountForm, currencies: Currency[]): CreateAccountPayload {
  if (!form.account_type) {
    throw new Error('Account type is required before building a create-account payload')
  }

  const accountKind = ACCOUNT_KIND_BY_TYPE[form.account_type]
  const selectedCurrency = currencies.find((currency) => currency.id === form.currency)
  const minorUnitExponent = selectedCurrency?.minor_unit_exponent ?? 2
  const startingBalance = optionalAccountMoneyInputToMinorUnits(form.starting_balance, minorUnitExponent)
  const isLiability = accountKind === 'revolving' || accountKind === 'amortizing'

  return {
    account_kind: accountKind,
    account_type: form.account_type,
    tax_advantaged_category_id: form.tax_advantaged_category_id || null,
    name: form.name.trim(),
    institution_id: form.institution_id || null,
    currency: form.currency,
    credit_limit: accountKind === 'revolving'
      ? optionalAccountMoneyInputToMinorUnits(form.credit_limit, minorUnitExponent)
      : null,
    starting_balance: startingBalance === null ? null : isLiability ? -startingBalance : startingBalance,
    is_archived: false,
  }
}
