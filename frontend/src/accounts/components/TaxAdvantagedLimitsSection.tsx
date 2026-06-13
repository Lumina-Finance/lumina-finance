import {
  useRef,
  type MouseEvent as ReactMouseEvent,
} from 'react'
import {
  DeferredChartTooltipOverlay,
  type DeferredChartTooltipOverlayHandle,
} from '@/components/charts/DeferredChartTooltipOverlay'
import type { TaxAdvantagedCategory } from '@/api/taxAdvantagedCategories'
import type { TaxAdvantagedLimitSummary } from '@/accounts/types/accounts'

function limitUsageColor(used: number, limit: number): string {
  if (limit <= 0) return used > 0 ? 'var(--app-negative)' : 'var(--app-text-muted)'
  const ratio = used / limit
  if (ratio > 1) return 'var(--app-negative)'
  if (limit - used === 0) return 'var(--app-text-muted)'
  return 'var(--app-accent)'
}

function limitUsagePercent(used: number, limit: number): number {
  if (limit <= 0) return 100
  return Math.min(Math.max((used / limit) * 100, 0), 100)
}

function clampPercent(value: number): number {
  return Math.min(Math.max(value, 0), 100)
}

function limitRemainingColor(remaining: number): string {
  if (remaining < 0) return 'var(--app-negative)'
  if (remaining === 0) return 'var(--app-text-muted)'
  return 'var(--app-accent)'
}

function getMajorCurrencyAmount(minorUnits: number, currency: string): number {
  const formatter = new Intl.NumberFormat(undefined, { style: 'currency', currency })
  const exponent = formatter.resolvedOptions().maximumFractionDigits ?? 2
  return minorUnits / Math.pow(10, exponent) || 0
}

function formatNoDecimalCurrency(value: number, currency: string): string {
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency,
    currencySign: 'accounting',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value)
}

function formatNoDecimalCurrencyWithSuffix(
  value: number,
  currency: string,
  suffix: 'K' | 'M',
): string {
  const formatter = new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency,
    currencySign: 'accounting',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  })
  const parts = formatter.formatToParts(value)
  const numberPartTypes = new Set(['integer', 'group'])
  const suffixIndex = parts.findLastIndex((part) => numberPartTypes.has(part.type))

  return parts
    .map((part, index) => `${part.value}${index === suffixIndex ? suffix : ''}`)
    .join('')
}

function formatMeterLimitMoney(amount: number, currency: string): string {
  const majorUnits = getMajorCurrencyAmount(amount, currency)
  const absoluteMajorUnits = Math.abs(majorUnits)
  if (absoluteMajorUnits >= 1_000_000) {
    return formatNoDecimalCurrencyWithSuffix(majorUnits / 1_000_000, currency, 'M')
  }
  if (absoluteMajorUnits >= 1_000) {
    return formatNoDecimalCurrencyWithSuffix(majorUnits / 1_000, currency, 'K')
  }
  return formatNoDecimalCurrency(majorUnits, currency)
}

function formatRawLimitMoney(amount: number, currency: string): string {
  return formatNoDecimalCurrency(getMajorCurrencyAmount(amount, currency), currency)
}

function getLifetimeAvailableBoundary(plan: TaxAdvantagedCategory): number | null {
  if (
    plan.lifetime_contribution_limit === null ||
    plan.accrued_lifetime_contribution_limit === null
  ) {
    return null
  }

  const boundary = Math.min(
    plan.accrued_lifetime_contribution_limit,
    plan.lifetime_contribution_limit,
  )
  if (
    boundary <= plan.lifetime_contributions ||
    boundary >= plan.lifetime_contribution_limit
  ) {
    return null
  }

  return Math.max(boundary, 0)
}

type LimitMeterTooltipData = {
  key: string
  label: string
  used: number
  remaining: number
  currency: string
}

function LimitMeterTooltipContent({
  label,
  used,
  remaining,
  currency,
}: {
  label: string
  used: number
  remaining: number
  currency: string
}) {
  return (
    <>
      <p className="app-chart-tooltip-default-title font-medium">{label}</p>
      <div className="mt-1 grid grid-cols-[auto_auto] gap-x-4 gap-y-1">
        <span className="app-chart-tooltip-default-value">Used</span>
        <span className="app-chart-tooltip-default-value text-right font-financial">
          {formatRawLimitMoney(used, currency)}
        </span>
        <span className="app-chart-tooltip-default-value">Remaining</span>
        <span
          className="app-chart-tooltip-default-value text-right font-financial"
          style={remaining < 0 ? { color: 'var(--app-negative)' } : undefined}
        >
          {formatRawLimitMoney(remaining, currency)}
        </span>
      </div>
    </>
  )
}

function CompactLimitMeter({
  label,
  used,
  limit,
  currency,
  emptyLabel = 'Not set',
  availableBoundary = null,
  valueMode = 'usage',
}: {
  label: string
  used: number
  limit: number | null
  currency: string
  emptyLabel?: string
  availableBoundary?: number | null
  valueMode?: 'usage' | 'remaining'
}) {
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

  const color = limitUsageColor(used, limit)
  const barWidth = limitUsagePercent(used, limit)
  const usageLabel = `${formatMeterLimitMoney(used, currency)} / ${formatMeterLimitMoney(limit, currency)}`
  const remaining = limit - used
  const remainingLabel =
    remaining < 0
      ? `${formatMeterLimitMoney(Math.abs(remaining), currency)} over`
      : formatMeterLimitMoney(remaining, currency)
  const valueLabel = valueMode === 'remaining' ? remainingLabel : usageLabel
  const availablePercent =
    availableBoundary === null ? 0 : limitUsagePercent(availableBoundary, limit)
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
        <p className="font-financial truncate text-xs font-medium tabular-nums" style={{ color: valueMode === 'remaining' ? limitRemainingColor(remaining) : 'var(--app-text-muted)' }}>
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
                left: `${clampPercent(barWidth)}%`,
                width: `${clampPercent(availableWidth)}%`,
                background: 'color-mix(in srgb, var(--app-accent) 26%, var(--app-border))',
              }}
            />
          )}
          <div
            className="absolute inset-y-0 left-0 rounded-full"
            style={{
              background: color,
              width: `${clampPercent(barWidth)}%`,
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
          <LimitMeterTooltipContent
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

function ContributionMeterStack({
  plan,
}: {
  plan: TaxAdvantagedCategory
}) {
  const showLifetimeMeter = plan.lifetime_contribution_limit !== null
  const annualMeter = (
    <CompactLimitMeter
      label="Annual"
      used={plan.ytd_contributions}
      limit={plan.current_year_contribution_limit}
      currency={plan.currency}
      valueMode="remaining"
    />
  )
  const lifetimeMeter = showLifetimeMeter ? (
    <CompactLimitMeter
      label="Lifetime"
      used={plan.lifetime_contributions}
      limit={plan.lifetime_contribution_limit}
      currency={plan.currency}
      availableBoundary={getLifetimeAvailableBoundary(plan)}
    />
  ) : null
  const withdrawalMeter = (
    <CompactLimitMeter
      label="Withdrawals"
      used={plan.ytd_withdrawals}
      limit={plan.current_year_withdrawal_limit}
      currency={plan.currency}
      emptyLabel="No limit"
      valueMode="remaining"
    />
  )

  if (!lifetimeMeter) {
    return (
      <div className="grid min-h-11 min-w-0 content-center gap-1.5">
        {annualMeter}
        {withdrawalMeter}
      </div>
    )
  }

  return (
    <div className="grid min-h-11 min-w-0 content-center gap-1.5">
      {lifetimeMeter}
      <div className="grid min-w-0 gap-3 min-[620px]:grid-cols-2">
        {annualMeter}
        {withdrawalMeter}
      </div>
    </div>
  )
}

function hasLimitTracking(plan: TaxAdvantagedCategory): boolean {
  return (
    plan.current_year_contribution_limit !== null ||
    plan.current_year_withdrawal_limit !== null ||
    plan.lifetime_contribution_limit !== null ||
    plan.accrued_lifetime_contribution_limit !== null ||
    plan.ytd_contributions !== 0 ||
    plan.ytd_withdrawals !== 0 ||
    plan.lifetime_contributions !== 0 ||
    plan.lifetime_withdrawals !== 0
  )
}

export default function TaxAdvantagedLimitsSection({
  summaries,
}: {
  summaries: TaxAdvantagedLimitSummary[]
}) {
  if (summaries.length === 0) return null

  return (
    <section>
      <div className="grid gap-x-10 gap-y-0 min-[1100px]:grid-cols-2 min-[1500px]:grid-cols-3">
        {summaries.map(({ plan, linkedAccountCount }) => {
          return (
            <div
              key={plan.id}
              className="min-w-0 py-3"
              data-tooltip-bounds
            >
              <div className="mb-2 flex min-w-0 items-baseline justify-between gap-3">
                <div className="flex min-w-0 items-baseline gap-2">
                  <p className="truncate font-medium">{plan.name}</p>
                  <p className="shrink-0 text-xs" style={{ color: 'var(--app-text-muted)' }}>
                    {plan.currency} · {linkedAccountCount} linked account{linkedAccountCount !== 1 ? 's' : ''}
                  </p>
                </div>
              </div>

              <div className="space-y-3">
                {hasLimitTracking(plan) && <ContributionMeterStack plan={plan} />}
              </div>
            </div>
          )
        })}
      </div>
      <div
        className="h-px"
        style={{
          background: 'var(--app-accent)',
        }}
      />
    </section>
  )
}
