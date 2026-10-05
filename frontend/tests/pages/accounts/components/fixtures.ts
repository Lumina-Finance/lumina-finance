/**
 * Builders for the account list component tests in this folder
 *
 * The utils folder keeps a builder of its own, since a test may not reach into another folder
 */
import type { AccountsOverview } from '@/api/accounts'
import type { TaxAdvantagedCategory } from '@/api/tax-advantaged-categories'

/** Builds a tax-free plan with no limits, for an account row to show as the plan it is linked to */
export function createPlan(overrides: Partial<TaxAdvantagedCategory> = {}): TaxAdvantagedCategory {
  return {
    id: 'plan-1',
    category_owner_user_id: 'user-1',
    group_id: null,
    name: 'TFSA',
    tax_treatment: 'tax_free',
    currency: 'EUR',
    lifetime_contribution_limit: null,
    accrued_contributions: 0,
    counts_internal_transfers: false,
    accrued_lifetime_contribution_limit: null,
    current_year_contribution_limit: null,
    current_year_withdrawal_limit: null,
    ytd_contributions: 0,
    ytd_withdrawals: 0,
    lifetime_contributions: 0,
    lifetime_withdrawals: 0,
    created_at: '2026-01-01T00:00:00Z',
    ...overrides,
  }
}

/** Builds a euro chequing account whose balance cannot be converted, so its row shows the FX badge */
export function createForeignAccount(overrides: Partial<AccountsOverview> = {}): AccountsOverview {
  return {
    id: 'account-1',
    owner_id: 'user-1',
    group_id: null,
    account_kind: 'asset',
    account_type: 'checking',
    tax_advantaged_category_id: null,
    name: 'Everyday Chequing',
    institution: null,
    currency: 'EUR',
    current_balance: 50_000,
    base_currency_current_balance: null,
    current_balance_fx_status: { state: 'unavailable', missing_pairs: [] },
    credit_limit: null,
    can_write: true,
    is_archived: false,
    ...overrides,
  }
}
