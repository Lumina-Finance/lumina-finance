/**
 * Builders for the account list tests in this folder
 *
 * Each takes the fields the test cares about and fills the rest with values that keep the row
 * unremarkable, so an assertion only ever turns on what its own test set
 */
import type { AccountsOverview } from '@/api/accounts'
import type { Currency } from '@/api/currency'
import type { Institution } from '@/api/institutions'
import type { TaxAdvantagedCategory } from '@/api/tax-advantaged-categories'

export const testCurrencies: Currency[] = [
  { id: 'USD', name: 'US Dollar', symbol: 'US$', minor_unit_exponent: 2 },
  { id: 'CAD', name: 'Canadian Dollar', symbol: '$', minor_unit_exponent: 2 },
]

export function createAccount(overrides: Partial<AccountsOverview>): AccountsOverview {
  return {
    id: overrides.id ?? 'account',
    owner_id: null,
    group_id: null,
    account_kind: overrides.account_kind ?? 'asset',
    account_type: overrides.account_type ?? 'checking',
    tax_advantaged_category_id: null,
    name: overrides.name ?? 'Account',
    institution: overrides.institution ?? null,
    currency: overrides.currency ?? 'USD',
    current_balance: overrides.current_balance ?? 0,
    base_currency_current_balance: overrides.base_currency_current_balance ?? null,
    current_balance_fx_status: overrides.current_balance_fx_status ?? { state: 'none', missing_pairs: [] },
    credit_limit: overrides.credit_limit ?? null,
    can_write: overrides.can_write ?? true,
    is_archived: overrides.is_archived ?? false,
    closed_at: null,
    ...overrides,
  }
}

export function createInstitution(id: string, name: string): Institution {
  return {
    id,
    status: 'active',
    name,
    country_code: 'US',
    website: `https://${id}.example.com`,
    logo_url: null,
  }
}

export function createTaxAdvantagedCategory(overrides: Partial<TaxAdvantagedCategory>): TaxAdvantagedCategory {
  return {
    id: overrides.id ?? 'plan',
    category_owner_user_id: 'user',
    group_id: null,
    name: overrides.name ?? 'Plan',
    tax_treatment: 'tax_free',
    currency: overrides.currency ?? 'USD',
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
    ...overrides,
  }
}
