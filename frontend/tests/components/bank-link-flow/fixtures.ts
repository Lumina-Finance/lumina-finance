/**
 * Builders for the bank link flow's component tests
 */
import type { AccountsOverview } from '@/api/accounts'
import type { AccountBankStatus, BankConnection, BankProvidersResponse, DiscoveredBankAccount } from '@/api/bank-sync'
import type { Currency } from '@/api/currency'

/** Canadian dollars, the account's currency, and US dollars, a bank account's in another */
export const TEST_CURRENCIES: Currency[] = [
  { id: 'CAD', name: 'Canadian Dollar', symbol: '$', minor_unit_exponent: 2 },
  { id: 'USD', name: 'US Dollar', symbol: '$', minor_unit_exponent: 2 },
]

/** Builds user-1's own Canadian dollar chequing account, Everyday */
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

/** Builds a working SimpleFIN connection with no nickname, added Sep 2, 2026, reaching two bank accounts */
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

/** Builds a linkable Canadian dollar chequing account at Harbour Bank, as a connection lists it for Everyday */
export function createBankAccount(overrides: Partial<DiscoveredBankAccount> = {}): DiscoveredBankAccount {
  return {
    external_id: 'ACT-1',
    name: 'Everyday Chequing',
    institution_name: 'Harbour Bank',
    currency: 'CAD',
    balance: 125000,
    balance_date: '2026-10-04T12:00:00Z',
    linkable: true,
    unavailable_reason: null,
    unavailable_message: null,
    institution_differs: false,
    ...overrides,
  }
}

/** Builds Everyday's read of its link: never linked, unless told otherwise */
export function createStatus(overrides: Partial<AccountBankStatus> = {}): AccountBankStatus {
  return {
    account_id: 'account-1',
    link: null,
    previous_link: null,
    balance: null,
    opening_adjustment: null,
    ...overrides,
  }
}

/** Builds the providers read: SimpleFIN, open to new connections unless told otherwise, with sync running */
export function createProviders(offered = true): BankProvidersResponse {
  return {
    may_link: true,
    sync_running: true,
    providers: [
      {
        id: 'simplefin',
        name: 'SimpleFIN',
        site: 'SimpleFIN Bridge',
        description: 'Connects to banks through SimpleFIN Bridge',
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
