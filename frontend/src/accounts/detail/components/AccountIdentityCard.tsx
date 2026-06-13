import { Pencil } from 'lucide-react'
import type { Account } from '@/api/accounts'
import type { TaxAdvantagedCategory } from '@/api/taxAdvantagedCategories'
import { formatCurrency } from '@/utils/formatCurrency'
import { ACCOUNT_KIND_LABEL } from '@/accounts/detail/constants/accountDetail'
import { humanizeAccountType } from '@/accounts/detail/utils/formatAccountType'
import {
  getTaxAdvantagedUsageColor,
  getTaxAdvantagedUsagePercent,
} from '@/accounts/utils/taxAdvantagedLimits'

// Reuse the list logo treatment at a larger size for the account identity card.
function DetailInstitutionLogo({ institution }: { institution: Account['institution'] }) {
  const faviconUrl = institution?.website
    ? `https://t2.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&url=${encodeURIComponent(institution.website)}&size=256`
    : null
  return (
    <div
      className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-xl"
      style={
        faviconUrl
          ? undefined
          : {
              background: 'var(--app-accent-soft)',
              border: '1px solid var(--app-border)',
            }
      }
    >
      {faviconUrl ? (
        <img
          src={faviconUrl}
          alt={`${institution!.name} logo`}
          className="h-full w-full object-contain"
          loading="lazy"
        />
      ) : (
        <span className="select-none text-xl font-semibold" style={{ color: 'var(--app-accent)' }}>$</span>
      )}
    </div>
  )
}

function DetailLimitUsage({
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
        <div className="flex items-baseline justify-between gap-3">
          <p className="text-xs font-medium uppercase" style={{ color: 'var(--app-text-subtle)' }}>
            {label}
          </p>
          <p className="text-sm font-medium" style={{ color: 'var(--app-text-muted)' }}>
            N/A
          </p>
        </div>
      </div>
    )
  }

  const color = getTaxAdvantagedUsageColor(used, limit)
  const usageLabel = `${formatCurrency(used, currency)} / ${formatCurrency(limit, currency)}`
  const usagePercent = getTaxAdvantagedUsagePercent(used, limit)

  return (
    <div className="group relative">
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-xs font-medium uppercase" style={{ color: 'var(--app-text-subtle)' }}>
          {label}
        </p>
        <p className="font-financial text-sm font-semibold tabular-nums" style={{ color }}>
          {Math.round(usagePercent)}%
        </p>
      </div>
      <div className="relative mt-1">
        <div
          className="h-1.5 overflow-hidden rounded-full"
          style={{ background: 'var(--app-border)' }}
          role="progressbar"
          aria-label={`${label} usage`}
          aria-valuemin={0}
          aria-valuemax={Math.max(limit, 0)}
          aria-valuenow={Math.min(Math.max(used, 0), Math.max(limit, 0))}
          aria-valuetext={usageLabel}
        >
          <div
            className="h-full rounded-full"
            style={{
              background: color,
              width: `${usagePercent}%`,
            }}
          />
        </div>
        <div
          className="app-chart-tooltip-default-content app-chart-tooltip-default-value pointer-events-none absolute bottom-full left-1/2 z-20 mb-2 -translate-x-1/2 whitespace-nowrap font-medium opacity-0 transition-opacity duration-150 group-hover:opacity-100"
        >
          {usageLabel}
        </div>
      </div>
    </div>
  )
}

function TaxAdvantagedCategoryBand({
  plan,
  hasError,
}: {
  plan: TaxAdvantagedCategory | undefined
  hasError: boolean
}) {
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

function StandardAccountBand() {
  return (
    <div className="mt-5 pt-4 min-[750px]:mt-auto" style={{ borderTop: '1px solid var(--app-border)' }}>
      <p className="text-sm font-semibold">Standard account</p>
      <p className="mt-0.5 text-xs" style={{ color: 'var(--app-text-muted)' }}>
        No contribution or withdrawal limits
      </p>
    </div>
  )
}

export default function AccountIdentityCard({
  account,
  linkedTaxAdvantagedCategory,
  linkedTaxAdvantagedCategoryError,
  onEdit,
}: {
  account: Account
  linkedTaxAdvantagedCategory: TaxAdvantagedCategory | undefined
  linkedTaxAdvantagedCategoryError: unknown
  onEdit: () => void
}) {
  const linkedTaxAdvantagedCategoryId = account.group_id === null ? account.tax_advantaged_category_id : null
  const closedLabel = account.closed_at
    ? ' · Closed ' + new Date(account.closed_at).toLocaleDateString()
    : ''
  const identityFacts: { label: string; value: string }[] = [
    { label: 'Kind', value: ACCOUNT_KIND_LABEL[account.account_kind] ?? account.account_kind },
    { label: 'Type', value: humanizeAccountType(account.account_type) },
    { label: 'Currency', value: account.currency },
    {
      label: 'Credit limit',
      value: account.credit_limit === null ? '—' : formatCurrency(account.credit_limit, account.currency),
    },
  ]

  return (
    <section className="app-card relative flex flex-col min-[750px]:min-h-[440px]">
      {!account.closed_at && (
        <button
          type="button"
          aria-label="Edit account"
          className="app-icon-button absolute right-2 top-2"
          onClick={onEdit}
        >
          <Pencil size={14} aria-hidden />
        </button>
      )}

      <DetailInstitutionLogo institution={account.institution} />

      <h1 className="mt-4 font-serif text-[1.375rem] font-semibold leading-tight">{account.name}</h1>
      <p className="mt-1 text-sm" style={{ color: 'var(--app-text-muted)' }}>
        {account.institution?.name ?? 'No institution'}
        {closedLabel}
      </p>

      <dl className="mt-5 grid grid-cols-2 gap-x-5 gap-y-3">
        {identityFacts.map((fact) => (
          <div key={fact.label} className="min-w-0">
            <dt className="text-xs font-medium uppercase" style={{ color: 'var(--app-text-subtle)' }}>
              {fact.label}
            </dt>
            <dd className="mt-0.5 truncate text-sm font-medium">{fact.value}</dd>
          </div>
        ))}
      </dl>

      {linkedTaxAdvantagedCategoryId ? (
        <TaxAdvantagedCategoryBand
          plan={linkedTaxAdvantagedCategory}
          hasError={!!linkedTaxAdvantagedCategoryError}
        />
      ) : (
        <StandardAccountBand />
      )}
    </section>
  )
}
