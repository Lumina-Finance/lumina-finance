import {
  useId,
  useMemo,
  useState,
} from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { ChevronDown, Network } from 'lucide-react'
import type { FxStatus } from '@/api/shared/fx'
import IconTooltip from '@/components/IconTooltip'
import type {
  FundFlowData,
  FundFlowEntry,
} from '@/insights/types/fundFlow'
import { getFundFlowChartHeight } from '@/insights/utils/fundFlowChart'
import { getFundFlowFxStatusMessage } from '@/insights/utils/fxTooltipMessages'
import { formatCurrency } from '@/utils/formatCurrency'
import { FundFlowChart } from './fund-flow/FundFlowChart'
import { FxStatusBadge } from './FxStatusBadge'
import { SectionHeader } from './SectionHeader'
import { useInsightLoadingSnapshot } from './useInsightLoadingSnapshot'

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

const listTransition = { duration: 0.18, ease: [0.22, 1, 0.36, 1] } as const

function joinClassNames(...classNames: Array<string | undefined | false>) {
  return classNames.filter(Boolean).join(' ')
}

function getEntryKey([name, amount]: FundFlowEntry) {
  return `${name}\u0000${amount}`
}

/**
 * Removes matching reversed entries without dropping duplicate categories incorrectly
 */
function withoutMatchingEntries(entries: FundFlowEntry[], exclusions: FundFlowEntry[]) {
  const remainingExclusions = new Map<string, number>()
  for (const entry of exclusions) {
    const key = getEntryKey(entry)
    remainingExclusions.set(key, (remainingExclusions.get(key) ?? 0) + 1)
  }

  return entries.filter((entry) => {
    const key = getEntryKey(entry)
    const count = remainingExclusions.get(key) ?? 0
    if (count === 0) return true
    remainingExclusions.set(key, count - 1)
    return false
  })
}

/**
 * Renders one expandable fund-flow category list with flipped-entry labelling
 */
function FlowCategoryList({
  title,
  normalEntries,
  flippedEntries,
  flippedLabel,
  normalLabel,
  calculation,
  displayCurrency,
  open,
  onToggle,
}: {
  title: string
  normalEntries: FundFlowEntry[]
  flippedEntries: FundFlowEntry[]
  flippedLabel: string
  normalLabel: string
  calculation: string
  displayCurrency: string
  open: boolean
  onToggle: () => void
}) {
  const listId = useId()
  const shouldReduceMotion = useReducedMotion()
  const totalCount = normalEntries.length + flippedEntries.length
  const displayCount = flippedEntries.length > 0
    ? `${normalEntries.length} + ${flippedEntries.length}`
    : String(totalCount)
  const rows = [
    ...flippedEntries.map((entry) => ({ entry, label: flippedLabel, flipped: true })),
    ...normalEntries.map((entry) => ({ entry, label: normalLabel, flipped: false })),
  ]

  return (
    <div
      className="w-full self-start overflow-visible rounded-xl border border-[var(--app-border)]"
      onClick={(event) => event.stopPropagation()}
    >
      <div className="relative flex min-h-14 w-full items-center justify-between gap-4 px-3 py-2">
        <button
          type="button"
          className="absolute inset-0 rounded-xl text-left transition-colors duration-150 hover:bg-[var(--app-surface-soft)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--app-accent-soft)] motion-reduce:transition-none"
          aria-expanded={open}
          aria-controls={listId}
          onClick={onToggle}
        >
          <span className="sr-only">Toggle {title}</span>
        </button>
        <span className="pointer-events-none relative z-10 min-w-0">
          <span className="app-label inline-flex items-center gap-2">
            {title}
            <span className="pointer-events-auto">
              <IconTooltip
                label={`${title} calculation`}
                placement="top"
                widthClassName="w-72"
                size={14}
                strokeWidth={2.25}
              >
                {calculation}
              </IconTooltip>
            </span>
          </span>
          <span className="mt-1 block font-financial text-xl leading-none">
            {displayCount}
          </span>
        </span>
        <ChevronDown
          size={14}
          aria-hidden
          className={joinClassNames('pointer-events-none relative z-10 shrink-0 transition-transform duration-150 motion-reduce:transition-none', open && 'rotate-180')}
          style={{ color: 'var(--app-accent)' }}
        />
      </div>

      <AnimatePresence>
        {open && (
          <motion.div
            id={listId}
            initial={shouldReduceMotion ? false : { height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={shouldReduceMotion ? { opacity: 0 } : { height: 0, opacity: 0 }}
            transition={shouldReduceMotion ? { duration: 0 } : listTransition}
            className="overflow-hidden border-t border-[var(--app-border)]"
          >
            <div className="h-56 overflow-y-auto">
              {rows.length > 0 ? rows.map(({ entry: [name, amount], label, flipped }) => (
                <div
                  key={`${label}-${name}-${amount}`}
                  className="flex h-14 items-center justify-between gap-4 px-3 text-sm transition-colors duration-150 hover:bg-[var(--app-surface-soft)] motion-reduce:transition-none"
                >
                  <span className="min-w-0">
                    <span className="block truncate font-semibold">{name}</span>
                    <span
                      className="mt-0.5 block text-xs font-medium"
                      style={{ color: flipped ? 'var(--app-accent)' : 'var(--app-text-muted)' }}
                    >
                      {label}
                    </span>
                  </span>
                  <span className="shrink-0 font-financial">
                    {formatCurrency(amount, displayCurrency)}
                  </span>
                </div>
              )) : (
                <div className="flex h-56 items-center px-3 text-sm" style={{ color: 'var(--app-text-muted)' }}>
                  No categories in this range.
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
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
  } = useInsightLoadingSnapshot({
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
            <IconTooltip
              label="Fund Flow calculation"
              placement="top"
              widthClassName="w-72"
              size={14}
              strokeWidth={2.25}
            >
              Refunds and reversals are applied first. Money in flows to Income. Money out flows through Expenses. Transfers are excluded
            </IconTooltip>
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
        <FlowCategoryList
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
        <FlowCategoryList
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
