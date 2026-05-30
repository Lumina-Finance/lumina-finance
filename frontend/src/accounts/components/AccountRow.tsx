import { Link } from 'react-router-dom'
import { EyeOff } from 'lucide-react'
import type { AccountsOverview } from '@/api/accounts'
import type { TaxAdvantagedPlan } from '@/api/taxAdvantagedPlans'
import { formatCurrency } from '@/utils/formatCurrency'
import type { AccountAccent } from '@/accounts/types/accounts'

function humanizeAccountType(type: string): string {
  return type
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')
}

// Fixed-size slot for an institution logo. Linked institutions use Google's
// faviconV2 endpoint; cashflow-only accounts get the neutral badge.
function InstitutionLogo({ institution }: { institution: AccountsOverview['institution'] }) {
  const faviconUrl = institution?.website
    ? `https://t2.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&url=${encodeURIComponent(institution.website)}&size=256`
    : null

  return (
    <div
      className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-lg"
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
        <span
          className="select-none text-sm font-semibold"
          style={{ color: 'var(--app-accent)' }}
        >
          $
        </span>
      )}
    </div>
  )
}

export default function AccountRow({
  account,
  accent,
  showCreditLimit,
  taxAdvantagedPlanById,
  displayCurrency,
  isHidden = false,
}: {
  account: AccountsOverview
  accent: AccountAccent
  showCreditLimit: boolean
  taxAdvantagedPlanById: Map<string, TaxAdvantagedPlan>
  displayCurrency: string
  isHidden?: boolean
}) {
  const barColor = isHidden
    ? 'var(--app-text-muted)'
    : accent === 'positive' ? 'var(--app-positive)' : 'var(--app-negative)'
  const balanceColor =
    isHidden
      ? 'var(--app-text-muted)'
      : accent === 'positive'
        ? account.current_balance > 0
          ? 'var(--app-positive)'
          : account.current_balance < 0
            ? 'var(--app-negative)'
            : 'var(--app-text)'
        : account.current_balance < 0
          ? 'var(--app-negative)'
          : 'var(--app-text)'
  const linkedPlan = account.group_id === null && account.tax_advantaged_plan_id
    ? taxAdvantagedPlanById.get(account.tax_advantaged_plan_id)
    : undefined
  const metadataLabel = `${humanizeAccountType(account.account_type)}${account.institution ? ` · ${account.institution.name}` : ''}`
  const fxStatus = account.current_balance_fx_status
  const showConvertedBalance = fxStatus.state !== 'none'
  const convertedBalanceText = fxStatus.state === 'complete' && account.base_currency_current_balance !== null
    ? `≈ ${formatCurrency(account.base_currency_current_balance, displayCurrency)}`
    : 'FX unavailable'

  return (
    <Link
      to={`/accounts/${account.id}`}
      className={`flex min-w-0 items-stretch overflow-hidden rounded-xl transition-colors duration-150 hover:bg-[var(--app-accent-soft)] ${
        isHidden ? 'my-1 border border-dashed opacity-75 hover:opacity-100' : ''
      }`}
      style={isHidden ? { borderColor: 'var(--app-border)' } : undefined}
    >
      <div
        className="my-3 w-0.5 rounded-full"
        style={{ background: barColor, opacity: 0.3 }}
      />
      <div className="grid min-w-0 flex-1 grid-cols-[2.25rem_minmax(0,1fr)] items-center gap-x-3 gap-y-1 px-3 py-3.5 min-[730px]:flex min-[730px]:gap-4 min-[730px]:px-4">
        <InstitutionLogo institution={account.institution} />
        <div className="min-w-0 flex-1 overflow-hidden">
          <div className="flex min-w-0 items-center gap-2">
            <p className="min-w-0 truncate font-medium">{account.name}</p>
            {linkedPlan && (
              <span
                className="shrink-0 rounded-md px-2 py-0.5 text-xs font-medium"
                style={{
                  background: 'var(--app-accent-soft)',
                  color: 'var(--app-accent)',
                  border: '1px solid var(--app-accent-border)',
                }}
              >
                {linkedPlan.name}
              </span>
            )}
          </div>
          <div className="mt-0.5 flex min-w-0 items-center gap-2">
            {isHidden && (
              <EyeOff
                size={13}
                className="shrink-0"
                style={{ color: 'var(--app-text-muted)' }}
                aria-hidden
              />
            )}
            <p className="min-w-0 truncate text-sm" style={{ color: 'var(--app-text-muted)' }}>
              {metadataLabel}
            </p>
          </div>
        </div>
        <div className="col-start-2 min-w-0 text-left min-[730px]:shrink-0 min-[730px]:text-right">
          <p className="font-financial font-medium" style={{ color: balanceColor }}>
            {formatCurrency(account.current_balance, account.currency)}
          </p>
          {showConvertedBalance && (
            <p
              className="font-financial mt-0.5 text-xs"
              style={{ color: fxStatus.state === 'complete' ? 'var(--app-text-muted)' : 'var(--app-negative)' }}
            >
              {convertedBalanceText}
            </p>
          )}
          {showCreditLimit && account.credit_limit !== null && (
            <p
              className="font-financial mt-0.5 text-xs"
              style={{ color: 'var(--app-text-muted)' }}
            >
              {formatCurrency(account.credit_limit + account.current_balance, account.currency)} avail.
            </p>
          )}
        </div>
      </div>
    </Link>
  )
}
