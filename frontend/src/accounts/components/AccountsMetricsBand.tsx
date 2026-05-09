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
        className="grid grid-cols-2 py-5 min-[730px]:grid-cols-3"
        style={{ borderBottom: '1px solid var(--app-border-strong)' }}
      >
        <div className="order-2 min-w-0 pr-4 pt-5 min-[730px]:order-1 min-[730px]:pr-6 min-[730px]:pt-0">
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

        <div className="order-1 col-span-2 min-w-0 border-b border-[var(--app-border)] pb-5 min-[730px]:order-2 min-[730px]:col-span-1 min-[730px]:border-x min-[730px]:border-b-0 min-[730px]:px-6 min-[730px]:pb-0">
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

        <div className="order-3 min-w-0 border-l border-[var(--app-border)] pl-4 pt-5 min-[730px]:border-l-0 min-[730px]:pl-6 min-[730px]:pt-0">
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
