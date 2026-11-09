/**
 * Builders for the account page's bank link tests
 */
import type { Account } from '@/api/accounts'
import type {
  AccountBankStatus,
  BankConnection,
  BankImportProgress,
  BankLink,
  BankProvidersResponse,
  BankSyncStatus,
  PreviousBankLink,
} from '@/api/bank-sync'

/** Builds user-1's own Canadian dollar chequing account, Everyday */
export function createAccount(overrides: Partial<Account> = {}): Account {
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
    created_at: '2026-09-01T12:00:00Z',
    has_transactions_after_today: false,
    notes: null,
    ...overrides,
  }
}

/** Builds a first import from June 1, one of its two windows stored, that has found 12 items */
export function createImport(overrides: Partial<BankImportProgress> = {}): BankImportProgress {
  return {
    kind: 'initial',
    state: 'running',
    requested_start: '2026-06-01',
    windows_total: 2,
    windows_done: 1,
    items_found: 12,
    earliest_returned_date: '2026-06-02',
    ...overrides,
  }
}

/**
 * Builds a link's sync status on the tests' clock, noon in Toronto on Oct 5, 2026: synced an hour ago
 * and due again in three hours, with nothing waiting for review
 */
export function createSync(overrides: Partial<BankSyncStatus> = {}): BankSyncStatus {
  return {
    state: 'synced',
    last_success_at: '2026-10-05T15:00:00Z',
    last_failure: null,
    next_attempt_at: '2026-10-05T19:00:00Z',
    waiting_on_budget: false,
    held_by_provider: false,
    sync_running: false,
    sync_requested: false,
    waiting_new_count: 0,
    paused: false,
    review_warning: false,
    ...overrides,
  }
}

/** Builds Everyday's live link to Everyday Chequing at Harbour Bank through SimpleFIN, synced with no import running */
export function createLink(overrides: Partial<BankLink> = {}): BankLink {
  return {
    account_id: 'account-1',
    connection_id: 'connection-1',
    provider: 'simplefin',
    provider_name: 'SimpleFIN',
    provider_site: 'SimpleFIN Bridge',
    provider_available: true,
    external_account_id: 'ACT-1',
    external_account_name: 'Everyday Chequing',
    institution_name: 'Harbour Bank',
    import_start: '2026-06-01',
    linked_at: '2026-10-01T12:00:00Z',
    state: 'active',
    import: null,
    sync: createSync(),
    history_reminder: null,
    cut_off_day: null,
    ...overrides,
  }
}

/** Builds what Everyday was linked to before its unlink at noon on Sep 20, 2026 */
export function createPreviousLink(overrides: Partial<PreviousBankLink> = {}): PreviousBankLink {
  return {
    provider_name: 'SimpleFIN',
    external_account_id: 'ACT-1',
    external_account_name: 'Everyday Chequing',
    institution_name: 'Harbour Bank',
    unlinked_at: '2026-09-20T16:00:00Z',
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
    balance_match: null,
    ...overrides,
  }
}

/** Builds a working SimpleFIN connection with no nickname, reaching the given bank accounts */
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

/** Builds the providers read: SimpleFIN, open to new connections, for a user who may link, with sync running */
export function createProviders(overrides: Partial<BankProvidersResponse> = {}): BankProvidersResponse {
  return {
    may_link: true,
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
        offered: true,
        advertises_history: false,
        institution_limit: null,
        institutions_in_use: [],
      },
    ],
    ...overrides,
  }
}
