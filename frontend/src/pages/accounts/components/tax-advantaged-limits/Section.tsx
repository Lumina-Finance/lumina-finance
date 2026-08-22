import LoadFailure from '@/components/errors/LoadFailure'
import type { TaxAdvantagedLimitSummary } from '@/pages/accounts/types/accounts'
import { hasTaxAdvantagedLimitTracking } from '@/pages/accounts/utils/taxAdvantagedLimits'
import { TaxAdvantagedLimitMeterStack } from './LimitMeterStack'

/**
 * Renders tax-advantaged limit summaries for linked active accounts
 *
 * @param categoriesError - The rejection the category request reported, shown where it failed
 * @param categoriesFailed - Whether the category list failed, which leaves no summaries to build
 * @param summaries - One entry per category an active account is linked to
 */
export default function TaxAdvantagedLimitsSection({
  categoriesError,
  categoriesFailed,
  summaries,
}: {
  categoriesError: unknown
  categoriesFailed: boolean
  summaries: TaxAdvantagedLimitSummary[]
}) {
  // Summaries cached from an earlier session survive a failed request, since the query cache is
  // persisted, so the message sits above them rather than throwing readable limits away
  if (categoriesFailed) {
    return (
      <section>
        <LoadFailure error={categoriesError} subject="Contribution limits" />
        {summaries.length > 0 && renderSummaries(summaries)}
      </section>
    )
  }

  if (summaries.length === 0) return null

  return <section>{renderSummaries(summaries)}</section>
}

/**
 * Lays the summaries out in the responsive grid both the loaded and the failed case share
 */
function renderSummaries(summaries: TaxAdvantagedLimitSummary[]) {
  return (
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
  )
}
