import { useId, useState, type ReactNode } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { ChevronDown } from 'lucide-react'
import {
  ResponsiveContainer,
  Sankey,
  Tooltip,
  type SankeyNodeProps,
} from 'recharts'
import { formatCurrency } from '@/utils/formatCurrency'

type IncomeExpenseFlowNodeKind = 'income' | 'expense' | 'summary' | 'retained'

export type IncomeExpenseFlowNode = {
  name: string
  kind: IncomeExpenseFlowNodeKind
  labelSide?: 'left' | 'right'
}

type IncomeExpenseFlowLink = {
  source: number
  target: number
  value: number
}

export type IncomeExpenseFlowData = {
  nodes: IncomeExpenseFlowNode[]
  links: IncomeExpenseFlowLink[]
}

type FlowTooltipPayload = Partial<IncomeExpenseFlowNode> & {
  value?: number | string
  source?: IncomeExpenseFlowNode
  target?: IncomeExpenseFlowNode
  payload?: FlowTooltipPayload
}

type FlowTooltipItem = {
  name?: string
  value?: number | string
  payload?: FlowTooltipPayload
}

type SignAdjustedFlowEntry = [string, number]

type IncomeExpenseSankeyCardProps = {
  header: ReactNode
  flowData: IncomeExpenseFlowData
  incomeSources: SignAdjustedFlowEntry[]
  expenseCategories: SignAdjustedFlowEntry[]
  incomeOutflows: SignAdjustedFlowEntry[]
  expenseInflows: SignAdjustedFlowEntry[]
  incomeSourceCount: number
  expenseCategoryCount: number
  displayCurrency: string
  emptyLabel?: string
}

const MIN_CHART_HEIGHT = 450
const SANKEY_ROW_HEIGHT = 56
const SANKEY_VERTICAL_CHROME = 112
const listTransition = { duration: 0.18, ease: [0.22, 1, 0.36, 1] } as const

function joinClassNames(...classNames: Array<string | undefined | false>) {
  return classNames.filter(Boolean).join(' ')
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

function FlowNodeShape({ x, y, width, height, payload }: SankeyNodeProps) {
  const node = payload as unknown as IncomeExpenseFlowNode
  const fillByKind: Record<IncomeExpenseFlowNodeKind, string> = {
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

function SankeyFlowTooltip({
  active,
  payload,
  displayCurrency,
}: {
  active?: boolean
  payload?: FlowTooltipItem[]
  displayCurrency: string
}) {
  const item = payload?.[0]
  const amount = item?.value ?? item?.payload?.value ?? item?.payload?.payload?.value
  if (!active || !item || amount === undefined) return null

  return (
    <div className="app-chart-tooltip-default-content">
      <div className="flex min-w-36 justify-between gap-4">
        <span className="app-tooltip-muted">{getFlowTooltipName(item)}</span>
        <span className="font-financial">{formatCurrency(Number(amount), displayCurrency)}</span>
      </div>
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
          <span className="app-label app-label-compact block">{title}</span>
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

export function IncomeExpenseSankeyCard({
  header,
  flowData,
  incomeSources,
  expenseCategories,
  incomeOutflows,
  expenseInflows,
  incomeSourceCount,
  expenseCategoryCount,
  displayCurrency,
  emptyLabel = 'No income or expenses in this range.',
}: IncomeExpenseSankeyCardProps) {
  const [incomeListOpen, setIncomeListOpen] = useState(false)
  const [expenseListOpen, setExpenseListOpen] = useState(false)
  const normalIncomeSources = withoutMatchingEntries(incomeSources, expenseInflows)
  const normalExpenseCategories = withoutMatchingEntries(expenseCategories, incomeOutflows)
  const chartHeight = Math.max(
    MIN_CHART_HEIGHT,
    Math.max(incomeSourceCount, expenseCategoryCount) * SANKEY_ROW_HEIGHT + SANKEY_VERTICAL_CHROME,
  )

  return (
    <section
      className="app-card"
      onClick={() => {
        setIncomeListOpen(false)
        setExpenseListOpen(false)
      }}
    >
      {header}
      <div className="mb-3 grid items-start gap-3 min-[720px]:grid-cols-2">
        <FlowCategoryList
          title="Income Sources"
          normalEntries={normalIncomeSources}
          flippedEntries={expenseInflows}
          flippedLabel="Expense Inflow"
          normalLabel="Income Source"
          displayCurrency={displayCurrency}
          open={incomeListOpen}
          onToggle={() => setIncomeListOpen((current) => !current)}
        />
        <FlowCategoryList
          title="Expense Categories"
          normalEntries={normalExpenseCategories}
          flippedEntries={incomeOutflows}
          flippedLabel="Income Outflow"
          normalLabel="Expense Category"
          displayCurrency={displayCurrency}
          open={expenseListOpen}
          onToggle={() => setExpenseListOpen((current) => !current)}
        />
      </div>
      <div className="w-full" style={{ height: chartHeight }}>
        {flowData.nodes.length > 0 ? (
          <ResponsiveContainer width="100%" height="100%">
            <Sankey
              data={flowData}
              node={FlowNodeShape}
              nodePadding={18}
              nodeWidth={6}
              verticalAlign="top"
              link={{ stroke: 'var(--app-accent)', strokeOpacity: 0.24 }}
              margin={{ top: 18, right: 12, bottom: 18, left: 12 }}
            >
              <Tooltip
                wrapperClassName="app-chart-tooltip-default"
                content={<SankeyFlowTooltip displayCurrency={displayCurrency} />}
              />
            </Sankey>
          </ResponsiveContainer>
        ) : (
          <div className="flex h-full items-center justify-center text-sm" style={{ color: 'var(--app-text-muted)' }}>
            {emptyLabel}
          </div>
        )}
      </div>
    </section>
  )
}
