import {
  useRef,
  type MouseEvent as ReactMouseEvent,
} from 'react'
import {
  DeferredChartTooltipOverlay,
  type DeferredChartTooltipOverlayHandle,
} from '@/components/charts/DeferredChartTooltipOverlay'
import {
  clampTaxAdvantagedPercent,
  formatTaxAdvantagedMeterMoney,
  getTaxAdvantagedRemainingColor,
  getTaxAdvantagedUsageColor,
  getTaxAdvantagedUsagePercent,
} from '@/pages/accounts/utils/taxAdvantagedLimits'
import { TaxAdvantagedLimitMeterTooltipContent } from './TaxAdvantagedLimitMeterTooltipContent'

type LimitMeterTooltipData = {
  key: string
  label: string
  used: number
  remaining: number
  currency: string
}

type TaxAdvantagedCompactLimitMeterProps = {
  label: string
  used: number
  limit: number | null
  currency: string
  emptyLabel?: string
  availableBoundary?: number | null
  valueMode?: 'usage' | 'remaining'
}

/**
 * Renders one compact tax-advantaged limit meter and owns its tooltip state
 */
export function TaxAdvantagedCompactLimitMeter({
  label,
  used,
  limit,
  currency,
  emptyLabel = 'Not set',
  availableBoundary = null,
  valueMode = 'usage',
}: TaxAdvantagedCompactLimitMeterProps) {
  const meterRef = useRef<HTMLDivElement | null>(null)
  const tooltipRef = useRef<DeferredChartTooltipOverlayHandle<LimitMeterTooltipData>>(null)

  if (limit === null) {
    return (
      <div className="min-w-0">
        <div className="flex items-baseline justify-between gap-2">
          <p className="truncate text-xs font-medium uppercase" style={{ color: 'var(--app-text-subtle)' }}>
            {label}
          </p>
          <p className="font-financial truncate text-xs font-medium tabular-nums" style={{ color: 'var(--app-text-muted)' }}>
            {emptyLabel}
          </p>
        </div>
        <div className="mt-1 h-1 rounded-full" style={{ background: 'var(--app-border)' }} />
      </div>
    )
  }

  const color = getTaxAdvantagedUsageColor(used, limit)
  const barWidth = getTaxAdvantagedUsagePercent(used, limit)
  const usageLabel = `${formatTaxAdvantagedMeterMoney(used, currency)} / ${formatTaxAdvantagedMeterMoney(limit, currency)}`
  const remaining = limit - used
  const remainingLabel =
    remaining < 0
      ? `${formatTaxAdvantagedMeterMoney(Math.abs(remaining), currency)} over`
      : formatTaxAdvantagedMeterMoney(remaining, currency)
  const valueLabel = valueMode === 'remaining' ? remainingLabel : usageLabel
  const availablePercent =
    availableBoundary === null ? 0 : getTaxAdvantagedUsagePercent(availableBoundary, limit)
  const availableWidth = Math.max(availablePercent - Math.min(barWidth, 100), 0)
  const tooltipData: LimitMeterTooltipData = {
    key: `${label}-${used}-${limit}-${currency}`,
    label,
    used,
    remaining,
    currency,
  }

  return (
    <div
      ref={meterRef}
      className="relative min-w-0"
      onMouseLeave={() => tooltipRef.current?.hide()}
      onMouseMove={(event: ReactMouseEvent<HTMLDivElement>) => {
        tooltipRef.current?.show(tooltipData, {
          clientX: event.clientX,
          clientY: event.clientY,
        })
      }}
    >
      <div className="flex min-w-0 items-baseline justify-between gap-2">
        <p className="truncate text-xs font-medium uppercase" style={{ color: 'var(--app-text-subtle)' }}>
          {label}
        </p>
        <p className="font-financial truncate text-xs font-medium tabular-nums" style={{ color: valueMode === 'remaining' ? getTaxAdvantagedRemainingColor(remaining) : 'var(--app-text-muted)' }}>
          {valueLabel}
        </p>
      </div>
      <div className="mt-1">
        <div
          className="relative h-1 overflow-hidden rounded-full"
          style={{ background: 'var(--app-border)' }}
          role="progressbar"
          aria-label={`${label} usage`}
          aria-valuemin={0}
          aria-valuemax={Math.max(limit, 0)}
          aria-valuenow={Math.min(Math.max(used, 0), Math.max(limit, 0))}
          aria-valuetext={usageLabel}
        >
          {availableBoundary !== null && (
            <div
              className="absolute inset-y-0 rounded-full"
              style={{
                left: `${clampTaxAdvantagedPercent(barWidth)}%`,
                width: `${clampTaxAdvantagedPercent(availableWidth)}%`,
                background: 'color-mix(in srgb, var(--app-accent) 26%, var(--app-border))',
              }}
            />
          )}
          <div
            className="absolute inset-y-0 left-0 rounded-full"
            style={{
              background: color,
              width: `${clampTaxAdvantagedPercent(barWidth)}%`,
            }}
          />
        </div>
      </div>
      <DeferredChartTooltipOverlay
        ref={tooltipRef}
        chartRef={meterRef}
        className="min-w-44"
        showGuide={false}
        tooltipTransition="opacity 150ms ease-out"
        getKey={(item) => item.key}
        renderContent={(item) => (
          <TaxAdvantagedLimitMeterTooltipContent
            label={item.label}
            used={item.used}
            remaining={item.remaining}
            currency={item.currency}
          />
        )}
      />
    </div>
  )
}
