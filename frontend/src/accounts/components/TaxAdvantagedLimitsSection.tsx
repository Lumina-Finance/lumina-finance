import { formatCurrency } from '@/utils/formatCurrency'
import type { TaxAdvantagedLimitSummary } from '@/accounts/types/accounts'

function limitUsageColor(used: number, limit: number): string {
  if (limit <= 0) return used > 0 ? 'var(--app-negative)' : 'var(--app-text-muted)'
  const ratio = used / limit
  if (ratio > 1) return 'var(--app-negative)'
  if (limit - used === 0) return 'var(--app-text-muted)'
  return 'var(--app-accent)'
}

function limitUsagePercent(used: number, limit: number): number {
  if (limit <= 0) return 100
  return Math.min(Math.max((used / limit) * 100, 0), 100)
}

function limitRemainingColor(remaining: number): string {
  if (remaining < 0) return 'var(--app-negative)'
  if (remaining === 0) return 'var(--app-text-muted)'
  return 'var(--app-accent)'
}

function TaxLimitLedgerRow({
  label,
  used,
  limit,
  currency,
}: {
  label: string
  used: number
  limit: number | null
  currency: string
}) {
  if (limit === null) {
    return (
      <div>
        <div className="flex items-baseline justify-between gap-2">
          <p className="text-xs font-medium uppercase" style={{ color: 'var(--app-text-subtle)' }}>
            {label}
          </p>
          <p className="font-financial text-sm font-medium tabular-nums" style={{ color: 'var(--app-text-muted)' }}>
            Not set
          </p>
        </div>
        <div className="mt-1 h-1 rounded-full" style={{ background: 'var(--app-border)' }} />
      </div>
    )
  }

  const color = limitUsageColor(used, limit)
  const remaining = limit - used
  const overLimit = remaining < 0
  const barWidth = limitUsagePercent(used, limit)
  const amountColor = limitRemainingColor(remaining)

  return (
    <div>
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-xs font-medium uppercase" style={{ color: 'var(--app-text-subtle)' }}>
          {label}
        </p>
        <p className="font-financial truncate text-sm font-semibold tabular-nums" style={{ color: amountColor }}>
          {overLimit
            ? `${formatCurrency(Math.abs(remaining), currency)} over`
            : `${formatCurrency(remaining, currency)} left`}
        </p>
      </div>
      <div className="mt-1">
        <div
          className="h-1 overflow-hidden rounded-full"
          style={{ background: 'var(--app-border)' }}
          role="progressbar"
          aria-label={`${label} usage`}
          aria-valuemin={0}
          aria-valuemax={Math.max(limit, 0)}
          aria-valuenow={Math.min(Math.max(used, 0), Math.max(limit, 0))}
        >
          <div
            className="h-full rounded-full"
            style={{
              background: color,
              width: `${barWidth}%`,
            }}
          />
        </div>
      </div>
    </div>
  )
}

export default function TaxAdvantagedLimitsSection({
  summaries,
}: {
  summaries: TaxAdvantagedLimitSummary[]
}) {
  if (summaries.length === 0) return null

  return (
    <section>
      <div className="grid gap-x-10 gap-y-0 md:grid-cols-2 xl:grid-cols-3">
        {summaries.map(({ plan, linkedAccountCount }) => {
          return (
            <div
              key={plan.id}
              className="min-w-0 py-3"
            >
              <div className="mb-2 flex min-w-0 items-baseline justify-between gap-3">
                <div className="flex min-w-0 items-baseline gap-2">
                  <p className="truncate font-medium">{plan.name}</p>
                  <p className="shrink-0 text-xs" style={{ color: 'var(--app-text-muted)' }}>
                    {plan.currency} · {linkedAccountCount} linked account{linkedAccountCount !== 1 ? 's' : ''}
                  </p>
                </div>
              </div>

              <div className="grid min-w-0 gap-3 sm:grid-cols-2">
                <TaxLimitLedgerRow
                  label="Contributions"
                  used={plan.ytd_contributions}
                  limit={plan.current_year_contribution_limit}
                  currency={plan.currency}
                />
                <TaxLimitLedgerRow
                  label="Withdrawals"
                  used={plan.ytd_withdrawals}
                  limit={plan.current_year_withdrawal_limit}
                  currency={plan.currency}
                />
              </div>
            </div>
          )
        })}
      </div>
      <div
        className="mt-3 h-px"
        style={{
          background: 'var(--app-accent)',
        }}
      />
    </section>
  )
}
