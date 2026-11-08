/**
 * Builders for the new-account prompt's tests
 */
import type { AccountsOverview } from '@/api/accounts'
import type { BankConnection, BankProvidersResponse } from '@/api/bank-sync'

/** Builds the user's own new CAD chequing account, at a zero balance */
export function createAccount(overrides: Partial<AccountsOverview> = {}): AccountsOverview {
  return {
    id: 'account-1',
    owner_id: 'user-1',
    group_id: null,
    account_kind: 'asset',
    account_type: 'checking',
    tax_advantaged_category_id: null,
    name: 'Everyday',
    institution: null,
    currency: 'CAD',
    current_balance: 0,
    base_currency_current_balance: 0,
    current_balance_fx_status: { state: 'none', missing_pairs: [] },
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
    providers: [
      {
        id: 'simplefin',
        name: 'SimpleFIN',
        site: 'SimpleFIN Bridge',
        description: 'Connects to banks through SimpleFIN Bridge',
        in_beta: false,
        credential_fields: [
          { key: 'setup_token', label: 'Setup token', placeholder: 'Paste the token', max_length: 2048 },
        ],
        connect_steps: [],
        connects_from: 'settings',
        offered,
        history_limit_months: 12,
        advertises_history: false,
        institution_limit: null,
        institutions_in_use: [],
      },
    ],
  }
}

/** Builds a working SimpleFIN connection reaching no bank accounts yet */
export function createConnection(overrides: Partial<BankConnection> = {}): BankConnection {
  return {
    id: 'connection-1',
    provider: 'simplefin',
    provider_name: 'SimpleFIN',
    provider_site: 'SimpleFIN Bridge',
    provider_available: true,
    nickname: null,
    server_label: 'bridge.simplefin.org',
    created_at: '2026-09-02T15:00:00Z',
    status: 'active',
    accounts: [],
    choose_again_links: [],
    discovery_pending: false,
    request_budget: { limit: 24, used: 1, available_again_at: null, held_by_provider: false },
    ...overrides,
  }
}
