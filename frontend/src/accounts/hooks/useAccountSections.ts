import { useMemo } from 'react'
import type { AccountKind, AccountsOverview } from '@/api/accounts'

function sumByKind(accounts: AccountsOverview[], kind: AccountKind): number {
  return accounts
    .filter((account) => account.account_kind === kind)
    .reduce((sum, account) => sum + account.current_balance, 0)
}

const isDebtAccount = (account: AccountsOverview) => account.account_kind !== 'asset'

export function useAccountSections({
  rows,
  filteredRows,
}: {
  rows: AccountsOverview[]
  filteredRows: AccountsOverview[]
}) {
  return useMemo(() => {
    const byBalanceDesc = (a: AccountsOverview, b: AccountsOverview) =>
      b.current_balance - a.current_balance

    const totalAssets = sumByKind(rows, 'asset')
    const revolvingSubtotal = sumByKind(rows, 'revolving')
    const amortizingSubtotal = sumByKind(rows, 'amortizing')
    const totalDebts = revolvingSubtotal + amortizingSubtotal

    return {
      totalAssets,
      totalDebts,
      netWorth: totalAssets + totalDebts,
      assetCount: rows.filter((account) => account.account_kind === 'asset').length,
      debtCount: rows.filter(isDebtAccount).length,
      assetRows: filteredRows.filter((account) => account.account_kind === 'asset').sort(byBalanceDesc),
      revolvingRows: filteredRows.filter((account) => account.account_kind === 'revolving').sort(byBalanceDesc),
      amortizingRows: filteredRows.filter((account) => account.account_kind === 'amortizing').sort(byBalanceDesc),
      revolvingSubtotal,
      amortizingSubtotal,
    }
  }, [filteredRows, rows])
}
