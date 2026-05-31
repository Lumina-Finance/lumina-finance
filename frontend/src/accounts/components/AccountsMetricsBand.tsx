import { formatCurrency } from '@/utils/formatCurrency'
import type { AccountsMetricsViewModel } from '@/accounts/hooks/useAccountsMetrics'
import IconTooltip from '@/components/IconTooltip'
import { formatMissingFxPairs, getFxStatusMessage, getFxStatusTone } from '@/dashboard/utils/fxStatus'

function FxStatusTooltip({
  label,
  fxStatus,
}: {
  label: string
  fxStatus: AccountsMetricsViewModel['creditUsage']['fxStatus']
}) {
  if (!fxStatus) return null

  return (
    <IconTooltip
      label={label}
      icon="fx"
      fxTone={getFxStatusTone(fxStatus)}
      placement="top"
      widthClassName="w-64"
    >
      <span className="block">{getFxStatusMessage(fxStatus)}</span>
      {fxStatus.missing_pairs.length > 0 && (
        <span className="mt-2 block text-xs" style={{ color: 'var(--app-text-muted)' }}>
          Missing: {formatMissingFxPairs(fxStatus.missing_pairs)}
        </span>
      )}
    </IconTooltip>
  )
}

export default function AccountsMetricsBand({
  metrics,
  displayCurrency,
}: {
  metrics: AccountsMetricsViewModel
  displayCurrency: string
}) {
  const { savingsRate, creditUsage, runway } = metrics
  const savingsRateValue =
    !savingsRate.isLoading && savingsRate.value !== null
      ? `${savingsRate.value}%`
      : savingsRate.hasExpenses
        ? '−∞%'
        : 'N/A'
  const savingsRateCaption = savingsRate.isLoading
    ? 'Loading savings rate'
    : savingsRate.value !== null
      ? `${formatCurrency(savingsRate.net, displayCurrency)} of ${formatCurrency(savingsRate.income, displayCurrency)} this month`
      : savingsRate.hasExpenses
        ? 'No income this month'
        : 'No data this month'
  const creditUsageValue =
    !creditUsage.isLoading && creditUsage.hasCreditData ? `${creditUsage.utilization}%` : 'N/A'
  const creditUsageCaption = creditUsage.isLoading
    ? 'Loading credit totals'
    : creditUsage.hasCreditData
      ? `${formatCurrency(creditUsage.totalUsed, displayCurrency)} of ${formatCurrency(creditUsage.totalLimit, displayCurrency)}`
      : creditUsage.hasCreditLimits && creditUsage.fxStatus?.state !== 'none'
        ? 'FX unavailable'
        : creditUsage.hasCreditAccounts
          ? 'No credit limits set'
          : 'No revolving credit accounts'

  return (
    <section>
      <div
        style={{
          height: 1,
          background: 'var(--app-border-strong)',
          borderRadius: 1,
        }}
      />
      <div
        className="grid grid-cols-2 py-3 min-[730px]:grid-cols-3"
        style={{ borderBottom: '1px solid var(--app-border-strong)' }}
      >
        <div className="order-2 min-w-0 pr-4 pt-3 min-[730px]:order-1 min-[730px]:pr-6 min-[730px]:pt-0">
          <div className="mb-1 flex items-center gap-2">
            <p className="app-label">Savings Rate</p>
            <FxStatusTooltip label="Savings rate FX status" fxStatus={savingsRate.fxStatus} />
          </div>
          <p
            className="font-financial text-[clamp(1rem,1.7vw,1.5rem)] font-semibold"
            style={{ color: savingsRate.color }}
          >
            {savingsRateValue}
          </p>
          <div className="mt-2 space-y-1">
            <div
              className="h-1 overflow-hidden rounded-full"
              style={{ background: 'var(--app-border)' }}
            >
              <div
                className="h-full rounded-full"
                style={{
                  background: savingsRate.color,
                  width: `${Math.max(0, Math.min(savingsRate.value ?? 0, 100))}%`,
                }}
              />
            </div>
            <p
              className="font-financial text-[clamp(0.875rem,1vw,0.9375rem)]"
              style={{ color: 'var(--app-text-subtle)' }}
            >
              {savingsRateCaption}
            </p>
          </div>
        </div>

        <div className="order-1 col-span-2 min-w-0 border-b border-[var(--app-border)] pb-3 min-[730px]:order-2 min-[730px]:col-span-1 min-[730px]:border-x min-[730px]:border-b-0 min-[730px]:px-6 min-[730px]:pb-0">
          <div className="mb-1 flex items-center gap-2">
            <p className="app-label">Credit Usage</p>
            <FxStatusTooltip label="Credit FX status" fxStatus={creditUsage.fxStatus} />
          </div>
          <p
            className="font-financial text-[clamp(1rem,1.7vw,1.5rem)] font-semibold"
            style={{ color: creditUsage.color }}
          >
            {creditUsageValue}
          </p>
          <div className="mt-2 space-y-1">
            <div
              className="h-1 overflow-hidden rounded-full"
              style={{ background: 'var(--app-border)' }}
            >
              <div
                className="h-full rounded-full"
                style={{
                  background: creditUsage.color,
                  width: `${creditUsage.hasCreditData ? Math.max(0, Math.min(creditUsage.utilization, 100)) : 0}%`,
                }}
              />
            </div>
            <p
              className="font-financial text-[clamp(0.875rem,1vw,0.9375rem)]"
              style={{ color: 'var(--app-text-subtle)' }}
            >
              {creditUsageCaption}
            </p>
          </div>
        </div>

        <div className="relative order-3 min-w-0 border-l border-[var(--app-border)] pl-4 pt-3 min-[730px]:border-l-0 min-[730px]:pl-6 min-[730px]:pt-0">
          <div className="mb-1 flex items-center gap-2 pr-20">
            <p className="app-label">Runway</p>
            <FxStatusTooltip label="Runway FX status" fxStatus={runway.fxStatus} />
          </div>
          {runway.style && (
            <span
              className="absolute right-0 top-3 shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold min-[730px]:top-0"
              style={{ background: runway.style.bg, color: runway.style.fg }}
            >
              {runway.style.label}
            </span>
          )}
          <p
            className="font-financial text-[clamp(1rem,1.7vw,1.5rem)] font-semibold"
            style={{ color: runway.months === null ? 'var(--app-text-subtle)' : 'var(--app-text)' }}
          >
            {runway.label}
          </p>
          <div className="mt-2 space-y-1">
            <div
              className="h-1 overflow-hidden rounded-full"
              style={{ background: 'var(--app-border)' }}
            >
              <div
                className="h-full rounded-full"
                style={{
                  background: 'linear-gradient(to right, var(--app-positive), var(--app-accent))',
                  width: `${runway.progress}%`,
                }}
              />
            </div>
            <p
              className="font-financial text-[clamp(0.875rem,1vw,0.9375rem)]"
              style={{ color: 'var(--app-text-subtle)' }}
            >
              {runway.caption}
            </p>
          </div>
        </div>
      </div>
    </section>
  )
}
