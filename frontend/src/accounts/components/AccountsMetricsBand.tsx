import { formatCurrency } from '@/utils/formatCurrency'
import type { AccountsMetricsViewModel } from '@/accounts/hooks/useAccountsMetrics'

export default function AccountsMetricsBand({
  metrics,
  displayCurrency,
}: {
  metrics: AccountsMetricsViewModel
  displayCurrency: string
}) {
  const { savingsRate, creditUsage, runway } = metrics

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
        className="grid grid-cols-3 py-5"
        style={{ borderBottom: '1px solid var(--app-border-strong)' }}
      >
        <div className="pr-6">
          <p className="app-label mb-1">Savings Rate</p>
          <p
            className="font-financial text-[clamp(1rem,1.7vw,1.5rem)] font-semibold"
            style={{ color: savingsRate.color }}
          >
            {savingsRate.value !== null
              ? `${savingsRate.value}%`
              : savingsRate.hasExpenses
                ? '−∞%'
                : 'N/A'}
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
              {savingsRate.value !== null
                ? `${formatCurrency(savingsRate.net, displayCurrency)} of ${formatCurrency(savingsRate.income, displayCurrency)} this month`
                : savingsRate.hasExpenses
                  ? 'No income this month'
                  : 'No data this month'}
            </p>
          </div>
        </div>

        <div className="px-6" style={{ borderInline: '1px solid var(--app-border)' }}>
          <p className="app-label mb-1">Credit Usage</p>
          <p
            className="font-financial text-[clamp(1rem,1.7vw,1.5rem)] font-semibold"
            style={{ color: creditUsage.color }}
          >
            {creditUsage.hasCreditData ? `${creditUsage.utilization}%` : 'N/A'}
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
              {creditUsage.hasCreditData
                ? `${formatCurrency(creditUsage.totalUsed, displayCurrency)} of ${formatCurrency(creditUsage.totalLimit, displayCurrency)}`
                : creditUsage.hasCreditAccounts
                  ? 'No credit limits set'
                  : 'No revolving credit accounts'}
            </p>
          </div>
        </div>

        <div className="pl-6">
          <div className="mb-1 flex items-center gap-2">
            <p className="app-label">Runway</p>
            {runway.style && (
              <span
                className="shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold"
                style={{ background: runway.style.bg, color: runway.style.fg }}
              >
                {runway.style.label}
              </span>
            )}
          </div>
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
