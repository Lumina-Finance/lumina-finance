import type { ReactNode } from 'react'
import {
  Bar,
  BarChart,
  Cell,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { formatCurrency } from '@/utils/formatCurrency'

export type CashFlowGranularity = 'day' | 'week' | 'month'

export type CashFlowBarBucket = {
  label: string
  rangeLabel: string
  inflow: number
  outflow: number
  net: number
}

type CashFlowCardProps = {
  header: ReactNode
  granularity: CashFlowGranularity
  buckets: CashFlowBarBucket[]
  displayCurrency: string
}

function formatSignedCurrency(amount: number, currency: string) {
  if (amount === 0) return formatCurrency(amount, currency)
  return `${amount > 0 ? '+' : '-'}${formatCurrency(Math.abs(amount), currency)}`
}

function getSignedAmountColor(amount: number) {
  if (amount > 0) return 'var(--app-positive)'
  if (amount < 0) return 'var(--app-negative)'
  return 'var(--app-text)'
}

function CashFlowBarTooltip({
  active,
  payload,
  displayCurrency,
}: {
  active?: boolean
  payload?: Array<{ payload?: CashFlowBarBucket }>
  displayCurrency: string
}) {
  const bucket = payload?.[0]?.payload
  if (!active || !bucket) return null

  return (
    <div className="app-chart-tooltip-default-content min-w-48">
      <p className="app-tooltip-muted">{bucket.rangeLabel}</p>
      <div className="mt-1 flex justify-between gap-4">
        <span>Net</span>
        <span className="font-financial" style={{ color: getSignedAmountColor(bucket.net) }}>
          {formatSignedCurrency(bucket.net, displayCurrency)}
        </span>
      </div>
      <div className="mt-1 flex justify-between gap-4">
        <span>Inflow</span>
        <span className="font-financial" style={{ color: 'var(--app-positive)' }}>
          {formatCurrency(bucket.inflow, displayCurrency)}
        </span>
      </div>
      <div className="mt-1 flex justify-between gap-4">
        <span>Outflow</span>
        <span className="font-financial" style={{ color: 'var(--app-negative)' }}>
          {formatCurrency(bucket.outflow, displayCurrency)}
        </span>
      </div>
    </div>
  )
}

export function CashFlowCard({
  header,
  granularity,
  buckets,
  displayCurrency,
}: CashFlowCardProps) {
  const label = granularity === 'day' ? 'Daily' : granularity === 'week' ? 'Weekly' : 'Monthly'
  const hasActivity = buckets.some((bucket) => bucket.inflow > 0 || bucket.outflow > 0)
  const totalInflow = buckets.reduce((sum, bucket) => sum + bucket.inflow, 0)
  const totalOutflow = buckets.reduce((sum, bucket) => sum + bucket.outflow, 0)
  const totalNet = totalInflow - totalOutflow

  return (
    <section className="app-card">
      {header}
      <div className="flex h-[390px] flex-col">
        <div className="mb-3 pl-4">
          <p className="app-label app-label-compact">Net Cash Flow</p>
          <p
            className="mt-1 font-financial text-3xl leading-none tracking-tight"
            style={{ color: totalNet >= 0 ? 'var(--app-positive)' : 'var(--app-negative)' }}
          >
            {formatSignedCurrency(totalNet, displayCurrency)}
          </p>
        </div>
        <div className="min-h-0 flex-1">
          {!hasActivity ? (
            <div
              className="flex h-full w-full items-center justify-center text-sm"
              style={{ color: 'var(--app-text-subtle)' }}
            >
              No cash flow in this range
            </div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={buckets}
                margin={{ top: 8, right: 8, bottom: 0, left: 8 }}
                barCategoryGap="22%"
              >
                <XAxis
                  dataKey="label"
                  axisLine={false}
                  tickLine={false}
                  interval="preserveStartEnd"
                  minTickGap={32}
                  tick={{ fill: 'var(--app-text-subtle)', fontSize: 11 }}
                  tickMargin={4}
                />
                <YAxis
                  width={92}
                  axisLine={false}
                  tickLine={false}
                  domain={[
                    (dataMin: number) => Math.min(dataMin, 0),
                    (dataMax: number) => Math.max(dataMax, 0),
                  ]}
                  tick={{ fill: 'var(--app-text-subtle)', fontSize: 11 }}
                  tickFormatter={(value) => formatCurrency(Number(value), displayCurrency)}
                />
                <ReferenceLine y={0} stroke="var(--app-border-strong)" strokeWidth={1} />
                <Tooltip
                  cursor={{ fill: 'var(--app-accent-soft)', radius: 4 }}
                  wrapperClassName="app-chart-tooltip-default"
                  content={<CashFlowBarTooltip displayCurrency={displayCurrency} />}
                />
                <Bar dataKey="net" radius={4} maxBarSize={40}>
                  {buckets.map((bucket) => (
                    <Cell
                      key={bucket.rangeLabel}
                      fill={bucket.net >= 0 ? 'var(--app-chart-positive)' : 'var(--app-chart-negative)'}
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3 border-t border-[var(--app-border)] pt-3">
          <p className="text-xs" style={{ color: 'var(--app-text-muted)' }}>
            {label} net cash flow, including transfers. Hover a bar for inflow, outflow, and net.
          </p>
          <div className="flex items-center gap-4 text-xs" style={{ color: 'var(--app-text-muted)' }}>
            <span className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-sm" style={{ background: 'var(--app-chart-positive)' }} />
              Net positive
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-sm" style={{ background: 'var(--app-chart-negative)' }} />
              Net negative
            </span>
          </div>
        </div>
      </div>
    </section>
  )
}
