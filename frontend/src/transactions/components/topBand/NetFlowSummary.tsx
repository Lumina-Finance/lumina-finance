import { ArrowDownLeft, ArrowUpRight } from 'lucide-react'
import { formatCurrency } from '@/utils/formatCurrency'

export default function NetFlowSummary({
  inflow,
  outflow,
  displayCurrency,
}: {
  inflow: number
  outflow: number
  displayCurrency: string
}) {
  const netFlow = inflow + outflow
  const netColor = netFlow >= 0 ? 'var(--app-positive)' : 'var(--app-negative)'

  return (
    <div className="pr-6">
      <p className="app-label mb-1.5">Net Flow</p>
      <p
        className="font-financial font-semibold tracking-tight leading-none text-6xl"
        style={{ color: netColor }}
      >
        {netFlow >= 0 ? '+' : ''}{formatCurrency(netFlow, displayCurrency)}
      </p>
      <div className="mt-3 flex items-center gap-4">
        <span
          className="inline-flex items-center gap-1 font-financial text-sm font-medium"
          style={{ color: 'var(--app-positive)' }}
        >
          <ArrowDownLeft size={14} aria-hidden />
          {formatCurrency(inflow, displayCurrency)}
        </span>
        <span
          className="inline-flex items-center gap-1 font-financial text-sm font-medium"
          style={{ color: 'var(--app-negative)' }}
        >
          <ArrowUpRight size={14} aria-hidden />
          {formatCurrency(Math.abs(outflow), displayCurrency)}
        </span>
      </div>
    </div>
  )
}
