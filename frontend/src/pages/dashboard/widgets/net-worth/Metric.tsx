import type { Currency } from '@/api/currency'
import { useMoneyFormatters } from '@/hooks/useMoneyFormatters'
import { formatDashboardMoney } from '@/pages/dashboard/utils/formatDashboardMoney'
import { getAmountSign, getSignedAmountColor, MUTED_ZERO_COLOR, signMovedAmount } from '@/utils/negativeAmount'

type NetWorthMetricProps = {
  netWorth: number
  netWorthChange: number | null
  displayCurrency: string
}

/**
 * Formats dashboard net worth movement with an explicit positive or negative sign
 *
 * The sign is written apart from the magnitude, so a gain rounds its magnitude down and a loss rounds
 * its magnitude up, which reads the change as the less favourable of the two neighbouring figures
 */
function formatNetWorthChange(amount: number, currency: string, currencies: Currency[]) {
  const magnitude = formatDashboardMoney(Math.abs(amount), currency, 'netWorth', currencies, amount < 0 ? 'up' : 'down')
  return signMovedAmount(getAmountSign(amount), magnitude)
}

/**
 * Renders the current net worth amount and optional period movement
 */
export function NetWorthMetric({
  netWorth,
  netWorthChange,
  displayCurrency,
}: NetWorthMetricProps) {
  const { currencies } = useMoneyFormatters()
  const netWorthColor = netWorth < 0 ? 'var(--app-negative)' : 'var(--app-text)'
  const netWorthChangeColor = getSignedAmountColor(netWorthChange ?? 0, MUTED_ZERO_COLOR)

  return (
    <div className="inline-flex max-w-full items-end gap-2">
      <p
        className="min-w-0 font-financial font-normal tracking-tight leading-none text-3xl max-[1000px]:text-[1.6875rem]"
        style={{ color: netWorthColor }}
      >
        {formatDashboardMoney(netWorth, displayCurrency, 'netWorth', currencies, 'down')}
      </p>
      {netWorthChange != null && (
        <p
          className="shrink-0 pb-0.5 font-financial text-sm font-medium leading-none max-[1000px]:text-xs"
          style={{ color: netWorthChangeColor }}
          aria-label={`Net worth change ${formatNetWorthChange(netWorthChange, displayCurrency, currencies)}`}
        >
          {formatNetWorthChange(netWorthChange, displayCurrency, currencies)}
        </p>
      )}
    </div>
  )
}
