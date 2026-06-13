import type { TaxAdvantagedCategory } from '@/api/taxAdvantagedCategories'
import { getLifetimeAvailableBoundary } from '@/pages/accounts/utils/taxAdvantagedLimits'
import { TaxAdvantagedCompactLimitMeter } from './TaxAdvantagedCompactLimitMeter'

/**
 * Renders annual, lifetime, and withdrawal meters for one tax-advantaged category
 */
export function TaxAdvantagedLimitMeterStack({
  plan,
}: {
  plan: TaxAdvantagedCategory
}) {
  const showLifetimeMeter = plan.lifetime_contribution_limit !== null
  const annualMeter = (
    <TaxAdvantagedCompactLimitMeter
      label="Annual"
      used={plan.ytd_contributions}
      limit={plan.current_year_contribution_limit}
      currency={plan.currency}
      valueMode="remaining"
    />
  )
  const lifetimeMeter = showLifetimeMeter ? (
    <TaxAdvantagedCompactLimitMeter
      label="Lifetime"
      used={plan.lifetime_contributions}
      limit={plan.lifetime_contribution_limit}
      currency={plan.currency}
      availableBoundary={getLifetimeAvailableBoundary(plan)}
    />
  ) : null
  const withdrawalMeter = (
    <TaxAdvantagedCompactLimitMeter
      label="Withdrawals"
      used={plan.ytd_withdrawals}
      limit={plan.current_year_withdrawal_limit}
      currency={plan.currency}
      emptyLabel="No limit"
      valueMode="remaining"
    />
  )

  if (!lifetimeMeter) {
    return (
      <div className="grid min-h-11 min-w-0 content-center gap-1.5">
        {annualMeter}
        {withdrawalMeter}
      </div>
    )
  }

  return (
    <div className="grid min-h-11 min-w-0 content-center gap-1.5">
      {lifetimeMeter}
      <div className="grid min-w-0 gap-3 min-[620px]:grid-cols-2">
        {annualMeter}
        {withdrawalMeter}
      </div>
    </div>
  )
}
