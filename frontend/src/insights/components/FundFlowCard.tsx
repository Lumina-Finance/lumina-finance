import {
  useId,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type TransitionEvent as ReactTransitionEvent,
} from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { ChevronDown, Network } from 'lucide-react'
import {
  ResponsiveContainer,
  Sankey,
  type SankeyElementType,
  type SankeyLinkProps,
  type SankeyNodeProps,
} from 'recharts'
import { formatCurrency } from '@/utils/formatCurrency'
import {
  InsightLoadingContent,
  InsightLoadingOverlay,
} from './InsightLoadingTransition'
import { SectionHeader } from './SectionHeader'
import { useInsightLoadingSnapshot } from './useInsightLoadingSnapshot'

type FundFlowNodeKind = 'income' | 'expense' | 'summary' | 'retained'

export type FundFlowNode = {
  name: string
  kind: FundFlowNodeKind
  labelSide?: 'left' | 'right'
}

type FundFlowLink = {
  source: number
  target: number
  value: number
}

export type FundFlowData = {
  nodes: FundFlowNode[]
  links: FundFlowLink[]
}

type FlowTooltipPayload = Partial<FundFlowNode> & {
  value?: number | string
  source?: FundFlowNode
  target?: FundFlowNode
  payload?: FlowTooltipPayload
}

type FlowTooltipItem = {
  name?: string
  value?: number | string
  payload?: FlowTooltipPayload
}

type SankeyFlowTooltipData = {
  name: string
  amount: number
}

type SignAdjustedFlowEntry = [string, number]

type FundFlowSnapshot = {
  flowData: FundFlowData
  incomeSources: SignAdjustedFlowEntry[]
  expenseCategories: SignAdjustedFlowEntry[]
  incomeOutflows: SignAdjustedFlowEntry[]
  expenseInflows: SignAdjustedFlowEntry[]
  incomeSourceCount: number
  expenseCategoryCount: number
  displayCurrency: string
  emptyLabel: string
  chartHeight: number
}

type FundFlowCardProps = {
  flowData: FundFlowData
  incomeSources: SignAdjustedFlowEntry[]
  expenseCategories: SignAdjustedFlowEntry[]
  incomeOutflows: SignAdjustedFlowEntry[]
  expenseInflows: SignAdjustedFlowEntry[]
  incomeSourceCount: number
  expenseCategoryCount: number
  displayCurrency: string
  loading?: boolean
  transitionKey: string
}

const MIN_CHART_HEIGHT = 450
const SANKEY_ROW_HEIGHT = 56
const SANKEY_VERTICAL_CHROME = 112
const CHART_HEIGHT_DURATION_MS = 750
const listTransition = { duration: 0.18, ease: [0.22, 1, 0.36, 1] } as const
const chartHeightTransition = { duration: CHART_HEIGHT_DURATION_MS / 1000, ease: [0.22, 1, 0.36, 1] } as const

function joinClassNames(...classNames: Array<string | undefined | false>) {
  return classNames.filter(Boolean).join(' ')
}

function getFundFlowChartHeight(incomeSourceCount: number, expenseCategoryCount: number) {
  return Math.max(
    MIN_CHART_HEIGHT,
    Math.max(incomeSourceCount, expenseCategoryCount) * SANKEY_ROW_HEIGHT + SANKEY_VERTICAL_CHROME,
  )
}

function normalizeGeneratedFlowName(name?: string) {
  if (!name) return 'Flow'
  const [source, target] = name.split(' - ')
  if (!source || !target) return name
  if ((target === 'Income' || target === 'Expenses') && source !== 'Income' && source !== 'Expenses') return source
  if (source === 'Income' || source === 'Expenses') return target
  return target
}

function getFlowTooltipName(item: FlowTooltipItem) {
  const payload = item.payload
  const nestedPayload = payload?.payload
  const source = payload?.source ?? nestedPayload?.source
  const target = payload?.target ?? nestedPayload?.target

  if (!source || !target) {
    return normalizeGeneratedFlowName(item.name ?? payload?.name ?? nestedPayload?.name)
  }

  if (source.kind !== 'summary' && target.kind === 'summary') return source.name
  if (target.kind !== 'summary') return target.name
  return target.name
}

function getSankeyFlowTooltipData(
  item: SankeyNodeProps | SankeyLinkProps,
  type: SankeyElementType,
): SankeyFlowTooltipData | null {
  const payload = item.payload as FlowTooltipPayload | undefined
  const amount = payload?.value
  const numericAmount = Number(amount)
  if (amount === undefined || !Number.isFinite(numericAmount)) return null

  return {
    name: getFlowTooltipName({
      name: type === 'node' ? payload?.name : undefined,
      value: amount,
      payload,
    }),
    amount: numericAmount,
  }
}

function FlowNodeShape({ x, y, width, height, payload }: SankeyNodeProps) {
  const node = payload as unknown as FundFlowNode
  const fillByKind: Record<FundFlowNodeKind, string> = {
    income: 'var(--app-chart-positive)',
    expense: 'var(--app-chart-negative)',
    summary: 'var(--app-accent)',
    retained: 'var(--app-text-muted)',
  }
  const labelOnRight = node.labelSide
    ? node.labelSide === 'right'
    : node.kind === 'income' || (node.kind === 'summary' && node.name !== 'Expenses')
  const labelX = labelOnRight ? x + width + 10 : x - 10
  const anchor = labelOnRight ? 'start' : 'end'
  const nodeWidth = Math.max(width, 6)
  const nodeHeight = Math.max(height, 4)

  return (
    <g>
      <rect
        x={x}
        y={y}
        width={nodeWidth}
        height={nodeHeight}
        rx={3}
        fill={fillByKind[node.kind]}
        opacity={node.kind === 'summary' ? 0.95 : 1}
      />
      <text
        x={labelX}
        y={y + height / 2}
        textAnchor={anchor}
        dominantBaseline="middle"
        fontSize={15}
        fontWeight={600}
        fill="var(--app-text-muted)"
      >
        {node.name}
      </text>
    </g>
  )
}

function SankeyFlowTooltipContent({
  tooltip,
  displayCurrency,
}: {
  tooltip: SankeyFlowTooltipData
  displayCurrency: string
}) {
  return (
    <div className="flex min-w-36 justify-between gap-4">
      <span className="app-chart-tooltip-default-title">{tooltip.name}</span>
      <span className="app-chart-tooltip-default-value font-financial">
        {formatCurrency(tooltip.amount, displayCurrency)}
      </span>
    </div>
  )
}

function getEntryKey([name, amount]: SignAdjustedFlowEntry) {
  return `${name}\u0000${amount}`
}

function withoutMatchingEntries(entries: SignAdjustedFlowEntry[], exclusions: SignAdjustedFlowEntry[]) {
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

function FlowCategoryList({
  title,
  normalEntries,
  flippedEntries,
  flippedLabel,
  normalLabel,
  displayCurrency,
  open,
  onToggle,
}: {
  title: string
  normalEntries: SignAdjustedFlowEntry[]
  flippedEntries: SignAdjustedFlowEntry[]
  flippedLabel: string
  normalLabel: string
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
      className="w-full self-start overflow-hidden rounded-xl border border-[var(--app-border)]"
      onClick={(event) => event.stopPropagation()}
    >
      <button
        type="button"
        className="flex min-h-14 w-full items-center justify-between gap-4 px-3 py-2 text-left transition-colors duration-150 hover:bg-[var(--app-surface-soft)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--app-accent-soft)] motion-reduce:transition-none"
        aria-expanded={open}
        aria-controls={listId}
        onClick={onToggle}
      >
        <span className="min-w-0">
          <span className="app-label block">{title}</span>
          <span className="mt-1 block font-financial text-xl leading-none">
            {displayCount}
          </span>
        </span>
        <ChevronDown
          size={14}
          aria-hidden
          className={joinClassNames('shrink-0 transition-transform duration-150 motion-reduce:transition-none', open && 'rotate-180')}
          style={{ color: 'var(--app-accent)' }}
        />
      </button>

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

export function FundFlowCard({
  flowData,
  incomeSources,
  expenseCategories,
  incomeOutflows,
  expenseInflows,
  incomeSourceCount,
  expenseCategoryCount,
  displayCurrency,
  loading = false,
  transitionKey,
}: FundFlowCardProps) {
  const flowChartRef = useRef<HTMLDivElement>(null)
  const flowTooltipRef = useRef<HTMLDivElement>(null)
  const [hoveredFlowTooltip, setHoveredFlowTooltip] = useState<SankeyFlowTooltipData | null>(null)
  const [flowTooltipVisible, setFlowTooltipVisible] = useState(false)
  const incomingSnapshot = useMemo<FundFlowSnapshot>(() => ({
    flowData,
    incomeSources,
    expenseCategories,
    incomeOutflows,
    expenseInflows,
    incomeSourceCount,
    expenseCategoryCount,
    displayCurrency,
    emptyLabel: loading ? 'Loading fund flow...' : 'No income or expenses in this range.',
    chartHeight: getFundFlowChartHeight(incomeSourceCount, expenseCategoryCount),
  }), [
    displayCurrency,
    expenseCategories,
    expenseCategoryCount,
    expenseInflows,
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
  const updateFlowTooltipPosition = (event: ReactMouseEvent<Element>) => {
    const rect = flowChartRef.current?.getBoundingClientRect()
    const tooltip = flowTooltipRef.current
    if (!rect || !tooltip) return

    tooltip.style.setProperty('--flow-tooltip-x', `${event.clientX - rect.left}px`)
    tooltip.style.setProperty('--flow-tooltip-y', `${event.clientY - rect.top}px`)
  }
  const showFlowTooltip = (
    item: SankeyNodeProps | SankeyLinkProps,
    type: SankeyElementType,
    event: ReactMouseEvent<SVGGraphicsElement>,
  ) => {
    updateFlowTooltipPosition(event)

    const tooltip = getSankeyFlowTooltipData(item, type)
    if (!tooltip) {
      setFlowTooltipVisible(false)
      return
    }

    setHoveredFlowTooltip((current) => (
      current?.name === tooltip.name && current.amount === tooltip.amount ? current : tooltip
    ))
    setFlowTooltipVisible(true)
  }
  const hideFlowTooltip = () => {
    setFlowTooltipVisible(false)
  }
  const handleFlowTooltipTransitionEnd = (event: ReactTransitionEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget || event.propertyName !== 'opacity' || flowTooltipVisible) return
    setHoveredFlowTooltip(null)
  }

  return (
    <section
      className="app-card"
      onClick={() => {
        setIncomeListOpen(false)
        setExpenseListOpen(false)
      }}
    >
      <SectionHeader icon={Network} label="Fund Flow" />
      <div className="mb-3 grid items-start gap-3 min-[720px]:grid-cols-2">
        <FlowCategoryList
          title="Income Sources"
          normalEntries={normalIncomeSources}
          flippedEntries={displaySnapshot.expenseInflows}
          flippedLabel="Expense Inflow"
          normalLabel="Income Source"
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
          displayCurrency={displaySnapshot.displayCurrency}
          open={expenseListOpen}
          onToggle={() => setExpenseListOpen((current) => !current)}
        />
      </div>
      <motion.div
        className="relative w-full overflow-hidden"
        initial={false}
        animate={{ height: displaySnapshot.chartHeight }}
        transition={shouldReduceMotion ? { duration: 0 } : chartHeightTransition}
      >
        <InsightLoadingContent
          className="relative w-full"
          concealed={contentConcealed}
          shouldReduceMotion={shouldReduceMotion}
          style={{ height: displaySnapshot.chartHeight }}
        >
          <div
            ref={flowChartRef}
            className="relative h-full"
            onMouseMove={updateFlowTooltipPosition}
            onMouseLeave={hideFlowTooltip}
          >
            {displaySnapshot.flowData.nodes.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <Sankey
                  data={displaySnapshot.flowData}
                  node={FlowNodeShape}
                  nodePadding={18}
                  nodeWidth={6}
                  verticalAlign="top"
                  link={{ stroke: 'var(--app-accent)', strokeOpacity: 0.24 }}
                  margin={{ top: 18, right: 12, bottom: 18, left: 12 }}
                  onMouseEnter={showFlowTooltip}
                  onMouseLeave={hideFlowTooltip}
                />
              </ResponsiveContainer>
            ) : (
              <div className="flex h-full items-center justify-center text-sm" style={{ color: 'var(--app-text-muted)' }}>
                {displaySnapshot.emptyLabel}
              </div>
            )}
            <div
              ref={flowTooltipRef}
              className="app-chart-tooltip-default-content pointer-events-none absolute left-0 top-0 z-20"
              onTransitionEnd={handleFlowTooltipTransitionEnd}
              style={{
                opacity: flowTooltipVisible ? 1 : 0,
                transition: 'opacity 150ms ease-out',
                transform: 'translate3d(var(--flow-tooltip-x, 0px), var(--flow-tooltip-y, 0px), 0)',
              }}
            >
              {hoveredFlowTooltip && (
                <SankeyFlowTooltipContent
                  tooltip={hoveredFlowTooltip}
                  displayCurrency={displaySnapshot.displayCurrency}
                />
              )}
            </div>
          </div>
        </InsightLoadingContent>
        <InsightLoadingOverlay
          visible={loadingVisible}
          shouldReduceMotion={shouldReduceMotion}
          label="Loading fund flow"
        />
      </motion.div>
    </section>
  )
}
