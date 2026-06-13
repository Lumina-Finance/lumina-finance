import {
  ChartTooltipRow,
  ChartTooltipTitle,
} from '@/components/charts/ChartTooltipContent'
import { formatTaxAdvantagedRawMoney } from '@/accounts/utils/taxAdvantagedLimits'

type LimitMeterTooltipContentProps = {
  label: string
  used: number
  remaining: number
  currency: string
}

/**
 * Renders used and remaining limit values inside a tax-advantaged meter tooltip
 */
export function LimitMeterTooltipContent({
  label,
  used,
  remaining,
  currency,
}: LimitMeterTooltipContentProps) {
  return (
    <>
      <ChartTooltipTitle className="font-medium">{label}</ChartTooltipTitle>
      <ChartTooltipRow
        label="Used"
        value={formatTaxAdvantagedRawMoney(used, currency)}
        valueClassName="text-right"
        financialValue
      />
      <ChartTooltipRow
        label="Remaining"
        value={formatTaxAdvantagedRawMoney(remaining, currency)}
        valueClassName="text-right"
        valueStyle={remaining < 0 ? { color: 'var(--app-negative)' } : undefined}
        financialValue
      />
    </>
  )
}
