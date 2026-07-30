/**
 * Tests create-account modal helper behaviour so refactors catch broken dependent fields, validation, option filtering, and signed account payloads before the modal renders
 */
import { describe, expect, it } from 'vitest'
import type { Currency } from '@/api/currency'
import type { Institution } from '@/api/institutions'
import type { TaxAdvantagedCategory } from '@/api/tax-advantaged-categories'
import {
  buildCreateAccountPayload,
  buildCreateAccountViewModel,
  buildInitialCreateAccountForm,
  getNextCreateAccountForm,
  validateCreateAccountForm,
} from '@/pages/accounts/components/create-account-modal/utils/form'
import {
  buildCreateAccountCurrencyOptions,
  buildCreateAccountInstitutionOptions,
  buildCreateAccountTaxPlanOptions,
} from '@/pages/accounts/components/create-account-modal/utils/options'

const currencies: Currency[] = [
  { id: 'CAD', name: 'Canadian Dollar', symbol: '$', minor_unit_exponent: 2 },
  { id: 'JPY', name: 'Japanese Yen', symbol: '¥', minor_unit_exponent: 0 },
]

const institutions: Institution[] = [
  {
    id: 'td',
    status: 'active',
    name: 'TD',
    country_code: 'CA',
    website: 'https://td.com',
    logo_url: null,
  },
]

const taxAdvantagedCategories: TaxAdvantagedCategory[] = [
  {
    id: 'tfsa',
    category_owner_user_id: 'user',
    group_id: null,
    name: 'TFSA',
    tax_treatment: 'tax_free',
    currency: 'CAD',
    lifetime_contribution_limit: null,
    accrued_contributions: 0,
    accrued_lifetime_contribution_limit: null,
    current_year_contribution_limit: null,
    current_year_withdrawal_limit: null,
    ytd_contributions: 0,
    ytd_withdrawals: 0,
    lifetime_contributions: 0,
    lifetime_withdrawals: 0,
    created_at: '2026-01-01T00:00:00Z',
  },
  {
    id: 'grouped',
    category_owner_user_id: 'user',
    group_id: 'family',
    name: 'Grouped TFSA',
    tax_treatment: 'tax_free',
    currency: 'CAD',
    lifetime_contribution_limit: null,
    accrued_contributions: 0,
    accrued_lifetime_contribution_limit: null,
    current_year_contribution_limit: null,
    current_year_withdrawal_limit: null,
    ytd_contributions: 0,
    ytd_withdrawals: 0,
    lifetime_contributions: 0,
    lifetime_withdrawals: 0,
    created_at: '2026-01-01T00:00:00Z',
  },
]

describe('create account modal helpers', () => {
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

  it('builds dropdown options and filters tax-advantaged categories by ownership scope and currency', () => {
    expect(buildCreateAccountCurrencyOptions(currencies)[0]).toEqual({
      value: 'CAD',
      label: 'CAD — Canadian Dollar ($)',
    })
    expect(buildCreateAccountInstitutionOptions(institutions)).toEqual([
      { value: '', label: 'None' },
      { value: 'td', label: 'TD' },
    ])
    expect(buildCreateAccountTaxPlanOptions(taxAdvantagedCategories, 'CAD')).toEqual([
      { value: '', label: 'None' },
      { value: 'tfsa', label: 'TFSA' },
    ])
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
