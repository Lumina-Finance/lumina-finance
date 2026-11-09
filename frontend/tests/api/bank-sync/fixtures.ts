import type { BankImportState, BankLink, BankSyncState, BankSyncStatus } from '@/api/bank-sync/types'

/**
 * Builds a link's sync status: synced at noon on Sep 30 and due again at midnight, with nothing waiting
 */
export function createSyncStatus(overrides: Partial<BankSyncStatus> = {}): BankSyncStatus {
  return {
    state: 'synced',
    last_success_at: '2026-09-30T12:00:00Z',
    last_failure: null,
    next_attempt_at: '2026-10-01T00:00:00Z',
    waiting_on_budget: false,
    held_by_provider: false,
    sync_running: false,
    sync_requested: false,
    import_starts_at: null,
    waiting_new_count: 0,
    paused: false,
    review_warning: false,
    ...overrides,
  }
}

/**
 * Builds a link that last synced successfully and has nothing running
 */
export function createBankLink(overrides: Partial<BankLink> = {}): BankLink {
  return {
    account_id: 'account-1',
    connection_id: 'connection-1',
    provider: 'simplefin',
    provider_name: 'SimpleFIN',
    provider_site: 'SimpleFIN Bridge',
    provider_available: true,
    external_account_id: 'bank-account-1',
    external_account_name: 'Chequing',
    institution_name: 'Example Bank',
    import_start: '2026-01-01',
    linked_at: '2026-09-01T12:00:00Z',
    state: 'active',
    import: null,
    sync: createSyncStatus(),
    history_reminder: null,
    cut_off_day: null,
    ...overrides,
  }
}

/** The state the server gives a link whose import is in each state */
const IMPORT_SYNC_STATES: Record<BankImportState, BankSyncState> = {
  running: 'importing',
  waiting: 'retrying',
  waiting_on_budget: 'import_waiting_on_budget',
  complete: 'synced',
}

/**
 * Builds a link partway through its first import, in the given state
 */
export function createImportingBankLink(state: BankImportState): BankLink {
  return createBankLink({
    account_id: 'account-2',
    import: {
      kind: 'initial',
      state,
      requested_start: '2025-01-01',
      windows_total: 6,
      windows_done: 2,
      items_found: 40,
      earliest_returned_date: null,
    },
    sync: createSyncStatus({ state: IMPORT_SYNC_STATES[state], last_success_at: null }),
  })
}
