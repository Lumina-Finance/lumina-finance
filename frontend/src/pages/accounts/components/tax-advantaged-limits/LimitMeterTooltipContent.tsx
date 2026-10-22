import {
  ChartTooltipRow,
  ChartTooltipTitle,
} from '@/components/charts/TooltipContent'
import { useMoneyFormatters } from '@/hooks/useMoneyFormatters'

type TaxAdvantagedLimitMeterTooltipContentProps = {
  label: string
  used: number
  remaining: number
  currency: string
}

/**
 * Renders used and remaining limit values inside a tax-advantaged meter tooltip, as exact amounts at
 * the currency's own decimal places. Unlike the meter's compact labels, a tooltip never rounds or
 * abbreviates
 */
export function TaxAdvantagedLimitMeterTooltipContent({
  label,
  used,
  remaining,
  currency,
}: TaxAdvantagedLimitMeterTooltipContentProps) {
  const { formatCurrency } = useMoneyFormatters()

  return (
    <>
      <ChartTooltipTitle className="font-medium">{label}</ChartTooltipTitle>
      <ChartTooltipRow
        label="Used"
        value={formatCurrency(used, currency)}
        valueClassName="text-right"
        financialValue
      />
      <ChartTooltipRow
        label="Remaining"
        value={formatCurrency(remaining, currency)}
        valueClassName="text-right"
        valueStyle={remaining < 0 ? { color: 'var(--app-negative)' } : undefined}
        financialValue
      />
    </>
  )
}
