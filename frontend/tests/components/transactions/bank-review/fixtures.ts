import type { InfiniteData } from '@tanstack/react-query'
import type { AccountsOverview } from '@/api/accounts/types'
import type {
  BankLink,
  BankReviewItem,
  BankReviewItemKind,
  BankReviewPage,
  PendingBankTransaction,
} from '@/api/bank-sync/types'
import type { Currency } from '@/api/currency'

export const MINUS = String.fromCodePoint(0x2212)

/** US dollars and yen. Neither has a minor unit */
export const TEST_CURRENCIES: Currency[] = [
  { id: 'USD', name: 'US Dollar', symbol: '$', minor_unit_exponent: 2 },
  { id: 'JPY', name: 'Japanese Yen', symbol: '¥', minor_unit_exponent: 0 },
]

/** Builds one of user-1's own US dollar accounts, unless told otherwise */
export function createAccount(id: string, name: string, overrides: Partial<AccountsOverview> = {}): AccountsOverview {
  return {
    id,
    owner_id: 'user-1',
    group_id: null,
    account_kind: 'asset',
    account_type: 'checking',
    tax_advantaged_category_id: null,
    name,
    institution: null,
    currency: 'USD',
    current_balance: 0,
    base_currency_current_balance: 0,
    current_balance_fx_status: 'ok',
    credit_limit: null,
    can_write: true,
    is_archived: false,
    ...overrides,
  } as AccountsOverview
}

/** Builds an item of the given kind on an account, for 1250 minor units out on Sep 21 unless told otherwise */
export function createReviewItem(
  id: string,
  kind: BankReviewItemKind,
  accountId: string,
  overrides: Partial<BankReviewItem> = {},
): BankReviewItem {
  const bank = { date: '2026-09-21', amount: -1250, raw_amount: null, description: `GROCER ${id}` }
  return {
    id,
    kind,
    account_id: accountId,
    provider: 'simplefin',
    provider_name: 'SimpleFIN',
    received_at: '2026-09-22T12:00:00Z',
    version: 1,
    bank,
    transaction_id: kind === 'new' ? null : `transaction-${id}`,
    current: kind === 'new' ? null : { ...bank, amount: -1800 },
    changed_fields: kind === 'correction' ? ['amount'] : [],
    protected_fields: [],
    ...overrides,
  }
}

/** Builds a pending transaction on an account, for 1800 minor units out on Sep 23, reported at 09:00 UTC on Oct 5, unless told otherwise */
export function createPendingTransaction(
  id: string,
  accountId: string,
  overrides: Partial<PendingBankTransaction> = {},
): PendingBankTransaction {
  return {
    id,
    account_id: accountId,
    date: '2026-09-23',
    amount: -1800,
    raw_amount: null,
    description: `UBER TRIP ${id}`,
    observed_at: '2026-10-05T09:00:00Z',
    ...overrides,
  }
}

/** One synced SimpleFIN link for each account, since only a linked account has bank transactions */
export function createLinks(accountIds: string[]): BankLink[] {
  return accountIds.map((accountId) => ({
    account_id: accountId,
    connection_id: 'connection-1',
    provider: 'simplefin',
    provider_name: 'SimpleFIN',
    provider_site: 'SimpleFIN Bridge',
    provider_available: true,
    external_account_id: `bank-${accountId}`,
    external_account_name: accountId,
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
      waiting_new_count: 0,
      paused: false,
      review_warning: false,
    },
    history_reminder: null,
    cut_off_day: null,
  }))
}

/** The review list as one loaded page of these items, counted by kind unless told otherwise */
export function toPages(
  items: BankReviewItem[],
  counts: BankReviewPage['counts'] = countOf(items),
  nextCursor: string | null = null,
): InfiniteData<BankReviewPage, string | null> {
  return { pages: [{ items, counts, next_cursor: nextCursor }], pageParams: [null] }
}

function countOf(items: BankReviewItem[]): BankReviewPage['counts'] {
  return {
    new: items.filter((item) => item.kind === 'new').length,
    correction: items.filter((item) => item.kind === 'correction').length,
    removal: items.filter((item) => item.kind === 'removal').length,
  }
}

/** The text a reader sees, without the markup that keeps parts of it together */
export function textOf(markup: string): string {
  return markup.replace(/<[^>]+>/g, '')
}

/** How many item rows a rendered block holds */
export function rowCount(markup: string): number {
  return markup.split('role="listitem"').length - 1
}
