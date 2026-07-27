import type { AccountMonthlyCashFlow } from '@/api/accounts'
import { DATE_FORMATS, formatDate, parseYmd } from '@/utils/date'

// One extra month keeps the current partial month visible while averages use completed months only
export const CASH_FLOW_AVG_MONTHS = 6
export const CASH_FLOW_CHART_MONTHS = CASH_FLOW_AVG_MONTHS + 1

export type CashFlowBar = {
  label: string
  tooltipLabel?: string
  income: number
  expense: number
}

export type CashFlowAverage = {
  avgIn: number
  avgOut: number
}

/**
 * Projects backend monthly cash flow rows into chart bars and tooltip labels
 */
export function getMonthlyCashFlowBars(rows: AccountMonthlyCashFlow[] | undefined): CashFlowBar[] {
  return (rows ?? []).map((row) => {
    // A month the calendar does not have keeps its raw value on both labels, so the bar still
    // carries its income and expense totals rather than dropping out of the chart
    const monthDate = parseYmd(row.month)

    return {
      label: monthDate ? formatDate(monthDate, DATE_FORMATS.month) : row.month,
      tooltipLabel: monthDate ? formatDate(monthDate, DATE_FORMATS.monthYear) : row.month,
      income: row.income,
      expense: row.expenses,
    }
  })
}

/**
 * Averages completed months only so the current partial month does not skew the benchmark
 */
export function getCompletedCashFlowAverage(
  rows: AccountMonthlyCashFlow[] | undefined,
): CashFlowAverage {
  if (!rows || rows.length <= 1) return { avgIn: 0, avgOut: 0 }
  const completed = rows.slice(0, -1)
  const totalIn = completed.reduce((sum, row) => sum + row.income, 0)
  const totalOut = completed.reduce((sum, row) => sum + row.expenses, 0)

  return {
    avgIn: Math.round(totalIn / completed.length),
    avgOut: Math.round(totalOut / completed.length),
  }
}

/**
 * Keeps monthly bars and the average bar on the same visible y-axis scale
 */
export function getCashFlowDomainMax(
  monthlyBars: CashFlowBar[],
  average: CashFlowAverage,
): number {
  const monthlyPeak = monthlyBars.reduce(
    (peak, month) => Math.max(peak, month.income, month.expense),
    0,
  )
  return Math.max(monthlyPeak, average.avgIn, average.avgOut, 1)
}
