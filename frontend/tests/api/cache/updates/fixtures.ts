import type { BankLink, BankReviewBacklog, BankReviewItem, BankReviewItemKind } from '@/api/bank-sync/types'
import type { Transaction } from '@/api/transactions/types'

/**
 * Builds a link that last synced successfully and has nothing running
 *
 * The bank sync folder keeps the same builder, since a test may not reach into another folder
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
    sync: {
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
    },
    history_reminder: null,
    cut_off_day: null,
    range_import: null,
    range_outcome: null,
    ...overrides,
  }
}

/**
 * Builds account-1's review backlog with three new items waiting, neither paused nor warned
 */
export function createBacklog(): BankReviewBacklog {
  return { account_id: 'account-1', waiting_new_count: 3, review_warning: false, paused: false }
}

/**
 * Builds a review item of the given kind for account-1, a correction or removal about the ledger
 * transaction `transaction-{id}`
 */
export function createReviewItem(id: string, kind: BankReviewItemKind): BankReviewItem {
  return {
    id,
    kind,
    account_id: 'account-1',
    provider: 'simplefin',
    provider_name: 'SimpleFIN',
    received_at: '2026-09-30T12:00:00Z',
    version: 1,
    bank: {
      date: '2026-09-29',
      amount: -1250,
      raw_amount: null,
      description: 'Coffee',
    },
    transaction_id: kind === 'new' ? null : `transaction-${id}`,
    current: null,
    changed_fields: kind === 'correction' ? ['amount'] : [],
    protected_fields: [],
  }
}

/**
 * Builds a bank-imported expense on account-1, waiting on the review item `reviewItemId` when one
 * is given
 */
export function createBankTransaction(id: string, reviewItemId: string | null = null): Transaction {
  return {
    id,
    created_by_user_id: 'test-user',
    account_id: 'account-1',
    dt: '2026-09-29',
    merchant_id: 'merchant',
    merchant_name: 'Test merchant',
    category_id: 'expense',
    amount: -1250,
    account_amount: null,
    base_currency_amount: null,
    currency: 'CAD',
    fx_rate: null,
    notes: null,
    counterparty_account_id: null,
    counterparty_account_scope: null,
    created_at: '2026-09-30T12:00:00Z',
    updated_at: '2026-09-30T12:00:00Z',
    tag_ids: [],
    tags: [],
    refund_of_transaction_id: null,
    refund_transaction_ids: [],
    bank_source: {
      provider: 'simplefin',
      provider_name: 'SimpleFIN',
      bank_values: {
        date: '2026-09-29',
        amount: -1250,
        raw_amount: null,
        description: 'Coffee',
      },
      received_at: '2026-09-29T09:05:00Z',
      edited_fields: [],
      review_item_id: reviewItemId,
    },
  }
}
