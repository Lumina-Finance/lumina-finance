import type { AccountKind, AccountsOverview } from '@/api/accounts'
import type { FxStatus } from '@/api/shared/fx'

export type AccountSections = {
  totalAssets: number
  totalDebts: number
  netWorth: number
  fxStatus: FxStatus
  assetCount: number
  debtCount: number
}

function getStatsBalance(account: AccountsOverview) {
  return account.base_currency_current_balance ?? account.current_balance
}

function sumByKind(accounts: AccountsOverview[], kind: AccountKind): number {
  return accounts
    .filter((account) => account.account_kind === kind)
    .reduce((sum, account) => sum + getStatsBalance(account), 0)
}

function isDebtAccount(account: AccountsOverview) {
  return account.account_kind !== 'asset'
}

/**
 * Combines per-account FX statuses into the single status shown beside net worth
 */
export function getCombinedAccountFxStatus(accounts: AccountsOverview[]): FxStatus {
  const statuses = accounts
    .map((account) => account.current_balance_fx_status)
    .filter((status) => status.state !== 'none')

  if (statuses.length === 0) return { state: 'none', missing_pairs: [] }

  const missingPairKeys = new Set<string>()
  const missingPairs = statuses
    .flatMap((status) => status.missing_pairs)
    .filter((pair) => {
      const key = `${pair.base}/${pair.quote}`
      if (missingPairKeys.has(key)) return false
      missingPairKeys.add(key)
      return true
    })

  if (missingPairs.length === 0) return { state: 'complete', missing_pairs: [] }

  return {
    state: statuses.every((status) => status.state === 'unavailable') ? 'unavailable' : 'incomplete',
    missing_pairs: missingPairs,
  }
}

/**
 * Builds the net worth statement figures from all unarchived rows. The list groups themselves are
 * built by `getAccountGroups`
 */
export function getAccountSections(rows: AccountsOverview[]): AccountSections {
  const totalAssets = sumByKind(rows, 'asset')
  const totalDebts = sumByKind(rows, 'revolving') + sumByKind(rows, 'amortizing')

  return {
    totalAssets,
    totalDebts,
    netWorth: totalAssets + totalDebts,
    fxStatus: getCombinedAccountFxStatus(rows),
    assetCount: rows.filter((account) => account.account_kind === 'asset').length,
    debtCount: rows.filter(isDebtAccount).length,
  }
}
