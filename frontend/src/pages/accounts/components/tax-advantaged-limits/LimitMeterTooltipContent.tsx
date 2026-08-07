import {
  ChartTooltipRow,
  ChartTooltipTitle,
} from '@/components/charts/TooltipContent'
import { useMoneyFormatters } from '@/hooks/useMoneyFormatters'
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
  const { currencies } = useMoneyFormatters()

  return (
    <>
      <ChartTooltipTitle className="font-medium">{label}</ChartTooltipTitle>
      <ChartTooltipRow
        label="Used"
        value={formatTaxAdvantagedRawMoney(used, currency, currencies)}
        valueClassName="text-right"
        financialValue
      />
      <ChartTooltipRow
        label="Remaining"
        value={formatTaxAdvantagedRawMoney(remaining, currency, currencies)}
        valueClassName="text-right"
        valueStyle={remaining < 0 ? { color: 'var(--app-negative)' } : undefined}
        financialValue
      />
    </>
  )
}
