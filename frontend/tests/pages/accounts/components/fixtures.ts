/**
 * Builders for the account list component tests in this folder
 *
 * The utils folder keeps a builder of its own, since a test may not reach into another folder
 */
import type { AccountsOverview } from '@/api/accounts'
import type { BankConnection, BankProvidersResponse } from '@/api/bank-sync'
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

/** Builds the providers read for a user the bank-linking check allows: SimpleFIN, open to new connections unless told otherwise */
export function createProviders({ mayLink = true, offered = true } = {}): BankProvidersResponse {
  return {
    may_link: mayLink,
    sync_running: true,
    providers: [{
      id: 'simplefin',
      name: 'SimpleFIN',
      description: 'Connects to banks through SimpleFIN Bridge',
      connects_from: 'settings',
      offered,
      history_limit_months: 12,
      advertises_history: false,
      institution_limit: null,
      institutions_in_use: [],
    }],
  }
}

/** Builds a working SimpleFIN connection reaching no bank accounts yet */
export function createConnection(overrides: Partial<BankConnection> = {}): BankConnection {
  return {
    id: 'connection-1',
    provider: 'simplefin',
    provider_name: 'SimpleFIN',
    nickname: null,
    server_label: 'bridge.simplefin.org',
    created_at: '2026-09-02T15:00:00Z',
    status: 'active',
    accounts: [],
    choose_again_links: [],
    discovery_pending: false,
    request_budget: { limit: 24, used: 1, available_again_at: null },
    ...overrides,
  }
}
