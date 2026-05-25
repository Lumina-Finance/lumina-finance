import type {
  InsightsFlowEntry,
  InsightsFundFlowResponse,
} from '@/api/insights'
import type { FundFlowData, FundFlowNode } from '../components/FundFlowCard'

const EMPTY_FLOW_ENTRIES: InsightsFlowEntry[] = []

export type FundFlowCardData = {
  flowData: FundFlowData
  incomeSources: InsightsFlowEntry[]
  expenseCategories: InsightsFlowEntry[]
  incomeOutflows: InsightsFlowEntry[]
  expenseInflows: InsightsFlowEntry[]
  incomeSourceCount: number
  expenseCategoryCount: number
}

function getFlowDataFromEntries(
  incomeEntries: InsightsFlowEntry[],
  expenseEntries: InsightsFlowEntry[],
  incomeFlowTotal = incomeEntries.reduce((sum, [, amount]) => sum + amount, 0),
): FundFlowData {
  if (incomeEntries.length === 0 && expenseEntries.length === 0) {
    return { nodes: [], links: [] }
  }

  const incomeTotal = incomeFlowTotal
  const expenseTotal = expenseEntries.reduce((sum, [, amount]) => sum + amount, 0)
  const nodes: FundFlowNode[] = [
    ...incomeEntries.map(([name]) => ({
      name,
      kind: 'income' as const,
      labelSide: 'right' as const,
    })),
    { name: 'Income', kind: 'summary' },
    { name: 'Expenses', kind: 'summary' },
    ...expenseEntries.map(([name]) => ({
      name,
      kind: 'expense' as const,
      labelSide: 'left' as const,
    })),
  ]
  const incomeSummaryIndex = incomeEntries.length
  const expenseSummaryIndex = incomeSummaryIndex + 1
  const retainedIndex = nodes.length
  const retained = Math.max(incomeTotal - expenseTotal, 0)
  if (retained > 0) {
    nodes.push({ name: 'Retained', kind: 'retained' })
  }

  const links = [
    ...incomeEntries.map(([, amount], index) => ({
      source: index,
      target: incomeSummaryIndex,
      value: amount,
    })),
    ...(retained > 0 ? [{ source: incomeSummaryIndex, target: retainedIndex, value: retained }] : []),
    ...(incomeTotal > 0 && expenseTotal > 0 ? [{
      source: incomeSummaryIndex,
      target: expenseSummaryIndex,
      value: Math.min(incomeTotal, expenseTotal),
    }] : []),
    ...expenseEntries.map(([, amount], index) => ({
      source: expenseSummaryIndex,
      target: expenseSummaryIndex + 1 + index,
      value: amount,
    })),
  ]

  return { nodes, links }
}

function getEntryTotal(entries: InsightsFlowEntry[]) {
  return entries.reduce((sum, [, amount]) => sum + amount, 0)
}

function getRefundAdjustedExpenseEntries(
  expenseEntries: InsightsFlowEntry[],
  expenseInflows: InsightsFlowEntry[],
) {
  let remainingRefundTotal = getEntryTotal(expenseInflows)
  if (remainingRefundTotal <= 0 || expenseEntries.length === 0) return expenseEntries

  const refundByName = new Map<string, number>()
  for (const [name, amount] of expenseInflows) {
    refundByName.set(name, (refundByName.get(name) ?? 0) + amount)
  }

  const nameAdjustedEntries = expenseEntries
    .map(([name, amount]): InsightsFlowEntry => {
      const matchingRefund = Math.min(refundByName.get(name) ?? 0, amount)
      if (matchingRefund > 0) {
        remainingRefundTotal -= matchingRefund
        refundByName.set(name, (refundByName.get(name) ?? 0) - matchingRefund)
      }
      return [name, amount - matchingRefund]
    })
    .filter(([, amount]) => amount > 0)

  if (remainingRefundTotal <= 0) return nameAdjustedEntries

  const expenseTotal = getEntryTotal(nameAdjustedEntries)
  const adjustedTotal = Math.max(expenseTotal - remainingRefundTotal, 0)
  if (adjustedTotal === 0) return []

  const scaledEntries = nameAdjustedEntries.map(([name, amount], index) => {
    const rawAmount = (amount * adjustedTotal) / expenseTotal
    const flooredAmount = Math.floor(rawAmount)
    return {
      name,
      amount: flooredAmount,
      index,
      remainder: rawAmount - flooredAmount,
    }
  })

  let unallocated = adjustedTotal - scaledEntries.reduce((sum, entry) => sum + entry.amount, 0)
  for (const entry of [...scaledEntries].sort((a, b) => b.remainder - a.remainder || a.index - b.index)) {
    if (unallocated <= 0) break
    entry.amount += 1
    unallocated -= 1
  }

  return scaledEntries
    .sort((a, b) => a.index - b.index)
    .filter((entry) => entry.amount > 0)
    .map((entry): InsightsFlowEntry => [entry.name, entry.amount])
}

function getFlowData(data: InsightsFundFlowResponse | undefined): FundFlowData {
  if (!data) {
    return { nodes: [], links: [] }
  }

  const expenseInflowTotal = getEntryTotal(data.expense_inflows)

  // Expense-kind inflows are drawn as income-side sources, then offset against
  // the expense-side links so refunds do not inflate the Expenses summary.
  return getFlowDataFromEntries(
    data.income_sources,
    getRefundAdjustedExpenseEntries(data.expense_categories, data.expense_inflows),
    Math.max(getEntryTotal(data.income_sources) - expenseInflowTotal, 0),
  )
}

export function getFundFlowCardData(
  data: InsightsFundFlowResponse | undefined,
): FundFlowCardData {
  return {
    flowData: getFlowData(data),
    incomeSources: data?.income_sources ?? EMPTY_FLOW_ENTRIES,
    expenseCategories: data?.expense_categories ?? EMPTY_FLOW_ENTRIES,
    incomeOutflows: data?.income_outflows ?? EMPTY_FLOW_ENTRIES,
    expenseInflows: data?.expense_inflows ?? EMPTY_FLOW_ENTRIES,
    incomeSourceCount: data?.income_source_count ?? 0,
    expenseCategoryCount: data?.expense_category_count ?? 0,
  }
}
