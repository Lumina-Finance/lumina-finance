import type { TaxAdvantagedCategory } from '@/api/tax-advantaged-categories'
import { DetailLimitUsage } from './LimitUsage'

type TaxAdvantagedCategoryBandProps = {
  plan: TaxAdvantagedCategory | undefined
  hasError: boolean
}

/**
 * Renders linked tax-advantaged category context and current-year limits
 */
export function TaxAdvantagedCategoryBand({
  plan,
  hasError,
}: TaxAdvantagedCategoryBandProps) {
  return (
    <div className="mt-5 pt-4 min-[750px]:mt-auto" style={{ borderTop: '1px solid var(--app-border)' }}>
      {hasError || !plan ? (
        <p className="text-sm" style={{ color: 'var(--app-text-subtle)' }}>
          Linked category unavailable
        </p>
      ) : (
        <>
          <div className="min-w-0">
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold">{plan.name}</p>
              <p className="mt-0.5 text-xs" style={{ color: 'var(--app-text-muted)' }}>
                Across linked accounts
              </p>
            </div>
          </div>

          {plan.current_year_contribution_limit === null &&
          plan.current_year_withdrawal_limit === null ? (
            <p className="mt-3 text-sm" style={{ color: 'var(--app-text-subtle)' }}>
              No current-year limits set
            </p>
          ) : (
            <div className="mt-3 space-y-3">
              <DetailLimitUsage
                label="Contribution limit"
                used={plan.ytd_contributions}
                limit={plan.current_year_contribution_limit}
                currency={plan.currency}
              />
              <DetailLimitUsage
                label="Withdrawal limit"
                used={plan.ytd_withdrawals}
                limit={plan.current_year_withdrawal_limit}
                currency={plan.currency}
              />
            </div>
          )}
        </>
      )}
    </div>
  )
}
