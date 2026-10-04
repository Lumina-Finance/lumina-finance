/**
 * Builders for the account list component tests in this folder
 *
 * The utils folder keeps a builder of its own, since a test may not reach into another folder
 */
import type { AccountsOverview } from '@/api/accounts'

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
