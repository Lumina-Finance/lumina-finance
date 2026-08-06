/**
 * Tests the create-account form, so the fields it clears when a dependent one changes, the errors it
 * raises and the signed minor-unit payload it builds cannot drift from the account type chosen
 */
import { describe, expect, it } from 'vitest'
import type { Currency } from '@/api/currency'
import {
  buildCreateAccountPayload,
  buildCreateAccountViewModel,
  buildInitialCreateAccountForm,
  getNextCreateAccountForm,
  validateCreateAccountForm,
} from '@/pages/accounts/components/create-account-modal/utils/form'

const currencies: Currency[] = [
  { id: 'CAD', name: 'Canadian Dollar', symbol: '$', minor_unit_exponent: 2 },
  { id: 'JPY', name: 'Japanese Yen', symbol: '¥', minor_unit_exponent: 0 },
]

describe('create account form helpers', () => {
  it('seeds the base currency and clears dependent fields when account type or currency changes', () => {
    const baseForm = {
      ...buildInitialCreateAccountForm('CAD'),
      account_type: 'checking' as const,
      tax_advantaged_category_id: 'tfsa',
      credit_limit: '1000',
    }

    expect(buildInitialCreateAccountForm('CAD')).toMatchObject({ currency: 'CAD' })
    expect(getNextCreateAccountForm(baseForm, 'account_type', 'loan')).toMatchObject({
      account_type: 'loan',
      credit_limit: '',
      tax_advantaged_category_id: '',
    })
    expect(getNextCreateAccountForm(baseForm, 'currency', 'JPY')).toMatchObject({
      currency: 'JPY',
      tax_advantaged_category_id: '',
    })
  })

  it('validates required fields and money inputs before payload construction', () => {
    expect(validateCreateAccountForm({
      ...buildInitialCreateAccountForm(null),
      credit_limit: '-1',
      starting_balance: 'abc',
    })).toEqual({
      account_type: 'Select an account type',
      name: 'Name is required',
      currency: 'Select a currency',
      credit_limit: 'Must be a positive number',
      starting_balance: 'Must be zero or higher',
    })
  })

  it('derives conditional fields and builds signed minor-unit payloads for liabilities', () => {
    const form = {
      ...buildInitialCreateAccountForm('CAD'),
      account_type: 'credit_card' as const,
      name: 'Rewards Card',
      institution_id: 'td',
      credit_limit: '10000.50',
      starting_balance: '123.45',
    }

    expect(buildCreateAccountViewModel(form, currencies)).toMatchObject({
      conditionalAccountField: 'credit-limit',
      isLiability: true,
      isRevolving: true,
      selectedAccountTypeLabel: 'Credit Card',
      selectedCurrencySymbol: '$',
      startingBalanceLabel: 'Starting Amount Owed',
    })
    expect(buildCreateAccountPayload(form, currencies)).toEqual({
      account_kind: 'revolving',
      account_type: 'credit_card',
      tax_advantaged_category_id: null,
      name: 'Rewards Card',
      institution_id: 'td',
      currency: 'CAD',
      credit_limit: 1000050,
      starting_balance: -12345,
      is_archived: false,
    })
  })

})
