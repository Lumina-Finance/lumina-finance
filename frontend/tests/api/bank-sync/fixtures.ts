import type { AccountBankLink, AccountBankStatus, BankImportState, BankLink } from '@/api/bank-sync/types';

/**
 * Builds a link that last synced successfully and has nothing running
 */
export function createBankLink(overrides: Partial<BankLink> = {}): BankLink {
  return {
    account_id: 'account-1',
    connection_id: 'connection-1',
    provider: 'simplefin',
    provider_name: 'SimpleFIN',
    external_account_id: 'bank-account-1',
    external_account_name: 'Chequing',
    institution_name: 'Example Bank',
    import_start: '2026-01-01',
    linked_at: '2026-09-01T12:00:00Z',
    import: null,
    history_reminder: null,
    last_success_at: '2026-09-30T12:00:00Z',
    last_attempt: null,
    next_attempt_at: '2026-10-01T00:00:00Z',
    waiting_on_budget: false,
    sync_in_progress: false,
    action_needed: null,
    waiting_new_count: 0,
    review_warning: false,
    paused: false,
    balance: null,
    ...overrides,
  };
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
  });
}

/**
 * Builds an account's live link as its page reads it, syncing with no import running
 */
export function createAccountBankLink(overrides: Partial<AccountBankLink> = {}): AccountBankLink {
  return {
    account_id: 'account-1',
    connection_id: 'connection-1',
    provider: 'simplefin',
    provider_name: 'SimpleFIN',
    external_account_id: 'bank-account-1',
    external_account_name: 'Everyday Chequing',
    institution_name: 'Harbour Bank',
    import_start: '2026-06-01',
    linked_at: '2026-10-01T12:00:00Z',
    state: 'active',
    import: null,
    ...overrides,
  };
}

/**
 * Builds the account page's read of a linked account whose first import from June 1 is partway
 * through, in the given state
 */
export function createImportingAccountStatus(state: BankImportState): AccountBankStatus {
  return {
    account_id: 'account-1',
    link: createAccountBankLink({
      import: {
        kind: 'initial',
        state,
        requested_start: '2026-06-01',
        windows_total: 2,
        windows_done: 1,
        items_found: 12,
        earliest_returned_date: '2026-06-02',
      },
    }),
    previous_link: null,
  };
}
