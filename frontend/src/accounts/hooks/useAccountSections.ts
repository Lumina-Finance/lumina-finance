import { useMemo } from 'react'
import type { AccountKind, AccountsOverview } from '@/api/accounts'
import type { FxStatus } from '@/api/dashboard'

function sumByKind(accounts: AccountsOverview[], kind: AccountKind): number {
  return accounts
    .filter((account) => account.account_kind === kind)
    .reduce((sum, account) => sum + getStatsBalance(account), 0)
}

const isDebtAccount = (account: AccountsOverview) => account.account_kind !== 'asset'

function getStatsBalance(account: AccountsOverview) {
  return account.base_currency_current_balance ?? account.current_balance
}

function getCombinedFxStatus(accounts: AccountsOverview[]): FxStatus {
  const statuses = accounts
    .map((account) => account.current_balance_fx_status)
    .filter((status) => status.state !== 'none')

  if (statuses.length === 0) return { state: 'none', missing_pairs: [] }

  const missingPairKeys = new Set<string>()
  const missingPairs = statuses.flatMap((status) => status.missing_pairs).filter((pair) => {
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

export function useAccountSections({
  rows,
  filteredRows,
}: {
  rows: AccountsOverview[]
  filteredRows: AccountsOverview[]
}) {
  return useMemo(() => {
    const byBalanceDesc = (a: AccountsOverview, b: AccountsOverview) =>
      getStatsBalance(b) - getStatsBalance(a)
    const byDebtBalanceDesc = (a: AccountsOverview, b: AccountsOverview) =>
      getStatsBalance(a) - getStatsBalance(b)

    const totalAssets = sumByKind(rows, 'asset')
    const revolvingSubtotal = sumByKind(rows, 'revolving')
    const amortizingSubtotal = sumByKind(rows, 'amortizing')
    const totalDebts = revolvingSubtotal + amortizingSubtotal

    return {
      totalAssets,
      totalDebts,
      netWorth: totalAssets + totalDebts,
      fxStatus: getCombinedFxStatus(rows),
      assetCount: rows.filter((account) => account.account_kind === 'asset').length,
      debtCount: rows.filter(isDebtAccount).length,
      assetRows: filteredRows.filter((account) => account.account_kind === 'asset').sort(byBalanceDesc),
      revolvingRows: filteredRows.filter((account) => account.account_kind === 'revolving').sort(byDebtBalanceDesc),
      amortizingRows: filteredRows.filter((account) => account.account_kind === 'amortizing').sort(byDebtBalanceDesc),
      revolvingSubtotal,
      amortizingSubtotal,
    }
  }, [filteredRows, rows])
}
