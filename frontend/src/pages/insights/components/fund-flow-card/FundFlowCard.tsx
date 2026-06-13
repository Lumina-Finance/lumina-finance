import { useMemo, useState } from 'react'
import { Network } from 'lucide-react'
import type { FxStatus } from '@/api/shared/fx'
import { useLoadingSnapshot } from '@/hooks/useLoadingSnapshot'
import type {
  FundFlowData,
  FundFlowEntry,
} from '@/pages/insights/types/fundFlow'
import { getFundFlowChartHeight } from '@/pages/insights/utils/fundFlowChart'
import { withoutMatchingEntries } from '@/pages/insights/utils/fundFlowEntries'
import { getFundFlowFxStatusMessage } from '@/pages/insights/utils/fxTooltipMessages'
import { FundFlowCategoryList } from './FundFlowCategoryList'
import { FundFlowChart } from './FundFlowChart'
import { FxStatusBadge } from '../FxStatusBadge'
import { InsightCalculationTooltip } from '../InsightCalculationTooltip'
import { SectionHeader } from '../SectionHeader'

type FundFlowSnapshot = {
  flowData: FundFlowData
  incomeSources: FundFlowEntry[]
  expenseCategories: FundFlowEntry[]
  incomeOutflows: FundFlowEntry[]
  expenseInflows: FundFlowEntry[]
  incomeSourceCount: number
  expenseCategoryCount: number
  fxStatus: FxStatus | undefined
  displayCurrency: string
  emptyLabel: string
  chartHeight: number
}

type FundFlowCardProps = {
  flowData: FundFlowData
  incomeSources: FundFlowEntry[]
  expenseCategories: FundFlowEntry[]
  incomeOutflows: FundFlowEntry[]
  expenseInflows: FundFlowEntry[]
  incomeSourceCount: number
  expenseCategoryCount: number
  fxStatus: FxStatus | undefined
  displayCurrency: string
  loading?: boolean
  transitionKey: string
}

/**
 * Renders fund-flow category lists and the Sankey flow chart
 */
export function FundFlowCard({
  flowData,
  incomeSources,
  expenseCategories,
  incomeOutflows,
  expenseInflows,
  incomeSourceCount,
  expenseCategoryCount,
  fxStatus,
  displayCurrency,
  loading = false,
  transitionKey,
}: FundFlowCardProps) {
  const incomingSnapshot = useMemo<FundFlowSnapshot>(() => ({
    flowData,
    incomeSources,
    expenseCategories,
    incomeOutflows,
    expenseInflows,
    incomeSourceCount,
    expenseCategoryCount,
    fxStatus,
    displayCurrency,
    emptyLabel: loading ? 'Loading fund flow...' : 'No income or expenses in this range.',
    chartHeight: getFundFlowChartHeight(incomeSourceCount, expenseCategoryCount),
  }), [
    displayCurrency,
    expenseCategories,
    expenseCategoryCount,
    expenseInflows,
    fxStatus,
    flowData,
    incomeOutflows,
    incomeSourceCount,
    incomeSources,
    loading,
  ])
  const [incomeListOpen, setIncomeListOpen] = useState(false)
  const [expenseListOpen, setExpenseListOpen] = useState(false)
  const {
    displaySnapshot,
    contentConcealed,
    loadingVisible,
    shouldReduceMotion,
  } = useLoadingSnapshot({
    snapshot: incomingSnapshot,
    loading,
    transitionKey,
  })
  const normalIncomeSources = withoutMatchingEntries(displaySnapshot.incomeSources, displaySnapshot.expenseInflows)
  const normalExpenseCategories = withoutMatchingEntries(displaySnapshot.expenseCategories, displaySnapshot.incomeOutflows)

  return (
    <section
      className="app-card"
      onClick={() => {
        setIncomeListOpen(false)
        setExpenseListOpen(false)
      }}
    >
      <SectionHeader
        icon={Network}
        label={(
          <span className="inline-flex items-center gap-2">
            Fund Flow
            <InsightCalculationTooltip
              label="Fund Flow"
              calculation="Refunds and reversals are applied first. Money in flows to Income. Money out flows through Expenses. Transfers are excluded"
            />
            {displaySnapshot.fxStatus && (
              <FxStatusBadge
                label="Fund Flow FX status"
                status={displaySnapshot.fxStatus}
                getMessage={getFundFlowFxStatusMessage}
              />
            )}
          </span>
        )}
      />
      <div className="mb-3 grid items-start gap-3 min-[720px]:grid-cols-2">
        <FundFlowCategoryList
          title="Income Sources"
          normalEntries={normalIncomeSources}
          flippedEntries={displaySnapshot.expenseInflows}
          flippedLabel="Expense Inflow"
          normalLabel="Income Source"
          calculation="Refunds reduce spending first before flipping into an income source. +x means categories that flipped"
          displayCurrency={displaySnapshot.displayCurrency}
          open={incomeListOpen}
          onToggle={() => setIncomeListOpen((current) => !current)}
        />
        <FundFlowCategoryList
          title="Expense Categories"
          normalEntries={normalExpenseCategories}
          flippedEntries={displaySnapshot.incomeOutflows}
          flippedLabel="Income Outflow"
          normalLabel="Expense Category"
          calculation="Reversals reduce income first before flipping into an expense category. +x means categories that flipped"
          displayCurrency={displaySnapshot.displayCurrency}
          open={expenseListOpen}
          onToggle={() => setExpenseListOpen((current) => !current)}
        />
      </div>
      <FundFlowChart
        flowData={displaySnapshot.flowData}
        chartHeight={displaySnapshot.chartHeight}
        displayCurrency={displaySnapshot.displayCurrency}
        emptyLabel={displaySnapshot.emptyLabel}
        contentConcealed={contentConcealed}
        loadingVisible={loadingVisible}
        shouldReduceMotion={shouldReduceMotion}
      />
    </section>
  )
}
