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

function getFlowData(data: InsightsFundFlowResponse | undefined): FundFlowData {
  if (!data) {
    return { nodes: [], links: [] }
  }

  const expenseInflowTotal = getEntryTotal(data.expense_inflows)

  // Expense-kind inflows are drawn as income-side sources, but expense
  // categories must stay as the backend's already-netted category totals.
  return getFlowDataFromEntries(
    data.income_sources,
    data.expense_categories,
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
