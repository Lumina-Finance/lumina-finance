import { formatDashboardMoney } from '@/dashboard/utils/formatDashboardMoney'

type NetWorthMetricProps = {
  netWorth: number
  netWorthChange: number | null
  displayCurrency: string
}

/**
 * Formats dashboard net worth movement with an explicit positive or negative sign
 */
function formatNetWorthChange(amount: number, currency: string) {
  if (amount === 0) return formatDashboardMoney(0, currency, 'netWorth')
  return `${amount > 0 ? '+' : '-'}${formatDashboardMoney(Math.abs(amount), currency, 'netWorth')}`
}

/**
 * Renders the current net worth amount and optional period movement
 */
export function NetWorthMetric({
  netWorth,
  netWorthChange,
  displayCurrency,
}: NetWorthMetricProps) {
  const netWorthColor = netWorth < 0 ? 'var(--app-negative)' : 'var(--app-text)'
  const netWorthChangeColor =
    netWorthChange == null || netWorthChange === 0
      ? 'var(--app-text-muted)'
      : netWorthChange > 0
        ? 'var(--app-positive)'
        : 'var(--app-negative)'

  return (
    <div className="inline-flex max-w-full items-end gap-2">
      <p
        className="min-w-0 font-financial font-normal tracking-tight leading-none text-3xl max-[1000px]:text-[1.6875rem]"
        style={{ color: netWorthColor }}
      >
        {formatDashboardMoney(netWorth, displayCurrency, 'netWorth')}
      </p>
      {netWorthChange != null && (
        <p
          className="shrink-0 pb-0.5 font-financial text-sm font-medium leading-none max-[1000px]:text-xs"
          style={{ color: netWorthChangeColor }}
          aria-label={`Net worth change ${formatNetWorthChange(netWorthChange, displayCurrency)}`}
        >
          {formatNetWorthChange(netWorthChange, displayCurrency)}
        </p>
      )}
    </div>
  )
}
