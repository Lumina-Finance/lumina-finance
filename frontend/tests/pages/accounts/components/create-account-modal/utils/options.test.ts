/**
 * Tests the dropdown options the create-account modal offers, so which currencies, institutions and
 * tax-advantaged plans appear cannot drift from the ownership scope and currency they are filtered by
 */
import { describe, expect, it } from 'vitest'
import type { Currency } from '@/api/currency'
import type { Institution } from '@/api/institutions'
import type { TaxAdvantagedCategory } from '@/api/tax-advantaged-categories'
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
    counts_internal_transfers: false,
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
    counts_internal_transfers: false,
    created_at: '2026-01-01T00:00:00Z',
  },
]

describe('create account option helpers', () => {
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
})
