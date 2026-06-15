import type { TaxAdvantagedLimitSummary } from '@/pages/accounts/types/accounts'
import { hasTaxAdvantagedLimitTracking } from '@/pages/accounts/utils/taxAdvantagedLimits'
import { TaxAdvantagedLimitMeterStack } from './LimitMeterStack'

/**
 * Renders tax-advantaged limit summaries for linked active accounts
 */
export default function TaxAdvantagedLimitsSection({
  summaries,
}: {
  summaries: TaxAdvantagedLimitSummary[]
}) {
  if (summaries.length === 0) return null

  return (
    <section>
      <div className="grid gap-x-10 gap-y-0 min-[1100px]:grid-cols-2 min-[1500px]:grid-cols-3">
        {summaries.map(({ plan, linkedAccountCount }) => {
          return (
            <div
              key={plan.id}
              className="min-w-0 py-3"
              data-tooltip-bounds
            >
              <div className="mb-2 flex min-w-0 items-baseline justify-between gap-3">
                <div className="flex min-w-0 items-baseline gap-2">
                  <p className="truncate font-medium">{plan.name}</p>
                  <p className="shrink-0 text-xs" style={{ color: 'var(--app-text-muted)' }}>
                    {plan.currency} · {linkedAccountCount} linked account{linkedAccountCount !== 1 ? 's' : ''}
                  </p>
                </div>
              </div>

              <div className="space-y-3">
                {hasTaxAdvantagedLimitTracking(plan) && <TaxAdvantagedLimitMeterStack plan={plan} />}
              </div>
            </div>
          )
        })}
      </div>
      <div
        className="h-px"
        style={{
          background: 'var(--app-accent)',
        }}
      />
    </section>
  )
}
