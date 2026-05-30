import type { AccountsOverview } from '@/api/accounts'
import type { RunwayResult } from '@/api/user'
import type { RunwaySegment } from '@/dashboard/types/dashboard'
import {
  getDeterministicChartColor,
  getDeterministicChartColorMap,
} from '@/utils/chartColor'

/**
 * Converts selected positive-balance runway accounts into proportional bar segments.
 * Hidden accounts and unavailable runway states produce no segments.
 */
export function getRunwaySegments(
  accounts: AccountsOverview[] | undefined,
  runwayAccountIds: string[] | undefined,
  runway: RunwayResult | undefined,
): RunwaySegment[] {
  if (!runway || runway.reason !== null) return []

  const ids = new Set(runwayAccountIds ?? [])
  const balanceByAccountId = new Map(
    runway.account_balances.map((accountBalance) => [
      accountBalance.account_id,
      accountBalance.balance,
    ]),
  )
  // Only selected visible accounts with positive balances contribute to the
  // bar; hidden accounts and liabilities are excluded before this helper.
  const rows = (accounts ?? [])
    .map((account) => ({
      account,
      balance: balanceByAccountId.get(account.id) ?? 0,
    }))
    .filter(({ account, balance }) => ids.has(account.id) && !account.is_hidden && balance > 0)
    .sort((a, b) => b.balance - a.balance)
  const total = rows.reduce((sum, row) => sum + row.balance, 0)
  if (total === 0) return []

  const accountColors = getDeterministicChartColorMap(rows.map(({ account }) => {
    const key = account.id || account.name

    return {
      key,
      seed: `runway-account:${key}`,
    }
  }))

  let cursor = 0
  return rows.map(({ account, balance }) => {
    const key = account.id || account.name
    const pct = (balance / total) * 100
    // centerPct is kept for consumers that need a stable tooltip anchor without
    // querying DOM widths for each proportional segment.
    const centerPct = cursor + pct / 2
    cursor += pct

    return {
      id: account.id,
      name: account.name,
      amount: balance,
      pct,
      centerPct,
      color: accountColors.get(key) ?? getDeterministicChartColor(`runway-account:${key}`),
    }
  })
}
