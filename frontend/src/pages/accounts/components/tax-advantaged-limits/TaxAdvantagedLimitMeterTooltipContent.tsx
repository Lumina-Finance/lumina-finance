import {
  ChartTooltipRow,
  ChartTooltipTitle,
} from '@/components/charts/ChartTooltipContent'
import { formatTaxAdvantagedRawMoney } from '@/pages/accounts/utils/taxAdvantagedLimits'

type TaxAdvantagedLimitMeterTooltipContentProps = {
  label: string
  used: number
  remaining: number
  currency: string
}

/**
 * Renders used and remaining limit values inside a tax-advantaged meter tooltip
 */
export function TaxAdvantagedLimitMeterTooltipContent({
  label,
  used,
  remaining,
  currency,
}: TaxAdvantagedLimitMeterTooltipContentProps) {
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
