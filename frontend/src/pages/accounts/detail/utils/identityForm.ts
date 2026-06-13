import type { Account, UpdateAccountPayload } from '@/api/accounts'
import type { Currency } from '@/api/currency'
import {
  fromMinorUnits,
  isValidMoneyInput,
  toMinorUnits,
} from '@/pages/accounts/detail/utils/moneyInput'

export interface IdentityFormValues {
  name: string
  institution_id: string
  tax_advantaged_category_id: string
  credit_limit: string
  is_archived: boolean
}

export type IdentityFieldErrors = Partial<Record<keyof IdentityFormValues, string>>

/**
 * Creates form state from the backend account shape while keeping optional links editable as blank fields
 */
export function createIdentityFormValues(
  account: Account,
  currencies: Currency[],
): IdentityFormValues {
  return {
    name: account.name,
    institution_id: account.institution?.id ?? '',
    tax_advantaged_category_id: account.tax_advantaged_category_id ?? '',
    credit_limit: fromMinorUnits(account.credit_limit, currencies, account.currency),
    is_archived: account.is_archived,
  }
}

/**
 * Validates fields that can break backend account updates before the mutation is submitted
 */
export function getIdentityFieldErrors(
  form: IdentityFormValues,
  isRevolving: boolean,
): IdentityFieldErrors {
  const errors: IdentityFieldErrors = {}
  if (!form.name.trim()) errors.name = 'Name is required.'
  else if (form.name.trim().length > 256) errors.name = 'Name must be 256 characters or less.'
  if (isRevolving && !isValidMoneyInput(form.credit_limit)) {
    errors.credit_limit = 'Credit limit must be zero or higher.'
  }
  return errors
}

/**
 * Builds the update payload with only fields the account type is allowed to send
 */
export function getIdentityUpdatePayload({
  form,
  isRevolving,
  canLinkTaxAdvantagedCategory,
  currencies,
  accountCurrency,
}: {
  form: IdentityFormValues
  isRevolving: boolean
  canLinkTaxAdvantagedCategory: boolean
  currencies: Currency[]
  accountCurrency: string
}): UpdateAccountPayload {
  return {
    name: form.name.trim(),
    institution_id: form.institution_id || null,
    is_archived: form.is_archived,
    ...(isRevolving
      ? { credit_limit: toMinorUnits(form.credit_limit, currencies, accountCurrency) }
      : {}),
    ...(canLinkTaxAdvantagedCategory
      ? { tax_advantaged_category_id: form.tax_advantaged_category_id || null }
      : {}),
  }
}
