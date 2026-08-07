import { useMoneyFormatters } from '@/hooks/useMoneyFormatters'
import {
  getTaxAdvantagedUsageColor,
  getTaxAdvantagedUsagePercent,
} from '@/pages/accounts/utils/taxAdvantagedLimits'

type DetailLimitUsageProps = {
  label: string
  used: number
  limit: number | null
  currency: string
}

/**
 * Renders one compact tax-advantaged limit meter inside the account identity card
 */
export function DetailLimitUsage({
  label,
  used,
  limit,
  currency,
}: DetailLimitUsageProps) {
  const { formatCurrency } = useMoneyFormatters()

  if (limit === null) {
    return (
      <div>
        <div className="flex items-baseline justify-between gap-3">
          <p className="text-xs font-medium uppercase" style={{ color: 'var(--app-text-subtle)' }}>
            {label}
          </p>
          <p className="text-sm font-medium" style={{ color: 'var(--app-text-muted)' }}>
            N/A
          </p>
        </div>
      </div>
    )
  }

  const color = getTaxAdvantagedUsageColor(used, limit)
  const usageLabel = `${formatCurrency(used, currency)} / ${formatCurrency(limit, currency)}`
  const usagePercent = getTaxAdvantagedUsagePercent(used, limit)

  return (
    <div className="group relative">
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-xs font-medium uppercase" style={{ color: 'var(--app-text-subtle)' }}>
          {label}
        </p>
        <p className="font-financial text-sm font-semibold tabular-nums" style={{ color }}>
          {Math.round(usagePercent)}%
        </p>
      </div>
      <div className="relative mt-1">
        <div
          className="h-1.5 overflow-hidden rounded-full"
          style={{ background: 'var(--app-border)' }}
          role="progressbar"
          aria-label={`${label} usage`}
          aria-valuemin={0}
          aria-valuemax={Math.max(limit, 0)}
          aria-valuenow={Math.min(Math.max(used, 0), Math.max(limit, 0))}
          aria-valuetext={usageLabel}
        >
          <div
            className="h-full rounded-full"
            style={{
              background: color,
              width: `${usagePercent}%`,
            }}
          />
        </div>
        <div
          className="app-chart-tooltip-default-content app-chart-tooltip-default-value pointer-events-none absolute bottom-full left-1/2 z-20 mb-2 -translate-x-1/2 whitespace-nowrap font-medium opacity-0 transition-opacity duration-150 group-hover:opacity-100"
        >
          {usageLabel}
        </div>
      </div>
    </div>
  )
}
