import type { ReactNode } from 'react'
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
}

type IncomeExpenseFlowLink = {
  source: number
  target: number
  value: number
}

type IncomeExpenseFlowData = {
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

type IncomeExpenseSankeyCardProps = {
  header: ReactNode
  flowData: IncomeExpenseFlowData
  incomeSourceCount: number
  expenseCategoryCount: number
  displayCurrency: string
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
    income: 'var(--app-positive)',
    expense: 'var(--app-negative)',
    summary: 'var(--app-accent)',
    retained: 'var(--app-text-muted)',
  }
  const labelOnRight = node.kind === 'income' || (node.kind === 'summary' && node.name !== 'Expenses')
  const labelX = labelOnRight ? x + width + 10 : x - 10
  const anchor = labelOnRight ? 'start' : 'end'

  return (
    <g>
      <rect
        x={x}
        y={y}
        width={Math.max(width, 6)}
        height={Math.max(height, 4)}
        rx={3}
        fill={fillByKind[node.kind]}
        opacity={node.kind === 'summary' ? 0.95 : 0.82}
      />
      {height >= 16 && (
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
      )}
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

export function IncomeExpenseSankeyCard({
  header,
  flowData,
  incomeSourceCount,
  expenseCategoryCount,
  displayCurrency,
}: IncomeExpenseSankeyCardProps) {
  return (
    <section className="app-card">
      {header}
      <div className="h-[450px] w-full">
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
      </div>
      <div className="mt-3 grid grid-cols-2 gap-6 border-t border-[var(--app-border)] pt-3">
        <div>
          <p className="app-label app-label-compact">Income Sources</p>
          <p className="mt-1 font-financial text-xl">
            {incomeSourceCount}
          </p>
        </div>
        <div>
          <p className="app-label app-label-compact">Expense Categories</p>
          <p className="mt-1 font-financial text-xl">
            {expenseCategoryCount}
          </p>
        </div>
      </div>
    </section>
  )
}
