import type { AccountsMetricsViewModel } from '@/pages/accounts/types/accounts'
import {
  getCreditUsageDisplay,
  getSavingsRateDisplay,
} from '@/pages/accounts/utils/metricDisplay'
import {
  getCreditFxStatusMessage,
  getRunwayFxStatusMessage,
  getSavingsRateFxStatusMessage,
} from '@/utils/fxTooltipMessages'
import { MetricPanel } from './Panel'

type MetricsBandProps = {
  metrics: AccountsMetricsViewModel
  displayCurrency: string
}

/**
 * Renders the accounts page metric band from prepared metric view models
 */
export default function MetricsBand({
  metrics,
  displayCurrency,
}: MetricsBandProps) {
  const { savingsRate, creditUsage, runway } = metrics
  const savingsRateDisplay = getSavingsRateDisplay(savingsRate, displayCurrency)
  const creditUsageDisplay = getCreditUsageDisplay(creditUsage, displayCurrency)

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
        className="grid grid-cols-1 py-3 min-[730px]:grid-cols-2 min-[1201px]:grid-cols-3"
        style={{ borderBottom: '1px solid var(--app-border-strong)' }}
      >
        <MetricPanel
          className="order-1 min-w-0 border-b border-[var(--app-border)] pb-3 min-[730px]:order-2 min-[730px]:border-b-0 min-[730px]:pr-4 min-[730px]:pt-3 min-[730px]:pb-0 min-[1201px]:order-1 min-[1201px]:pr-6 min-[1201px]:pt-0"
          label="Savings Rate"
          tooltipLabel="Savings rate FX status"
          fxStatus={savingsRate.fxStatus}
          getMessage={getSavingsRateFxStatusMessage}
          loading={savingsRate.isLoading}
          loadingLabel="Loading savings rate metric"
          value={savingsRateDisplay.value}
          valueColor={savingsRate.color}
          progress={savingsRate.progress}
          progressColor={savingsRate.color}
          caption={savingsRateDisplay.caption}
        />

        <MetricPanel
          className="order-2 min-w-0 border-b border-[var(--app-border)] py-3 min-[730px]:order-1 min-[730px]:col-span-2 min-[730px]:pt-0 min-[730px]:pb-3 min-[1201px]:order-2 min-[1201px]:col-span-1 min-[1201px]:border-x min-[1201px]:border-b-0 min-[1201px]:px-6 min-[1201px]:py-0"
          label="Credit Usage"
          tooltipLabel="Credit FX status"
          fxStatus={creditUsage.fxStatus}
          getMessage={getCreditFxStatusMessage}
          loading={creditUsage.isLoading}
          loadingLabel="Loading credit usage metric"
          value={creditUsageDisplay.value}
          valueColor={creditUsage.color}
          progress={creditUsage.hasCreditData ? Math.max(0, Math.min(creditUsage.utilization, 100)) : 0}
          progressColor={creditUsage.color}
          caption={creditUsageDisplay.caption}
        />

        <MetricPanel
          className="relative order-3 min-w-0 pt-3 min-[730px]:border-l min-[730px]:border-[var(--app-border)] min-[730px]:pl-4 min-[1201px]:border-l-0 min-[1201px]:pl-6 min-[1201px]:pt-0"
          label="Runway"
          tooltipLabel="Runway FX status"
          fxStatus={runway.fxStatus}
          getMessage={getRunwayFxStatusMessage}
          loading={runway.isLoading}
          loadingLabel="Loading runway metric"
          value={runway.label}
          valueColor={runway.months === null ? 'var(--app-text-subtle)' : 'var(--app-text)'}
          progress={runway.progress}
          progressColor="linear-gradient(to right, var(--app-positive), var(--app-accent))"
          caption={runway.caption}
          headerClassName="pr-20"
          badge={runway.style && (
            <span
              className="absolute right-0 top-3 shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold min-[1201px]:top-0"
              style={{ background: runway.style.bg, color: runway.style.fg }}
            >
              {runway.style.label}
            </span>
          )}
        />
      </div>
    </section>
  )
}
