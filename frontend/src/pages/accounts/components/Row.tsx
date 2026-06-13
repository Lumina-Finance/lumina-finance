import { Link } from 'react-router-dom'
import { EyeOff } from 'lucide-react'
import type { AccountsOverview } from '@/api/accounts'
import type { TaxAdvantagedCategory } from '@/api/taxAdvantagedCategories'
import { FxStatusBadge } from '@/components/tooltips/FxStatusBadge'
import { formatCurrency } from '@/utils/formatCurrency'
import { InstitutionLogo } from '@/pages/accounts/components/InstitutionLogo'
import { humanizeAccountType } from '@/pages/accounts/detail/utils/formatAccountType'
import type { AccountAccent } from '@/pages/accounts/types/accounts'
import { getAccountBalanceFxStatusMessage } from '@/pages/accounts/utils/fxTooltipMessages'

export default function AccountRow({
  account,
  accent,
  showCreditLimit,
  taxAdvantagedCategoryById,
  displayCurrency,
  isArchived = false,
}: {
  account: AccountsOverview
  accent: AccountAccent
  showCreditLimit: boolean
  taxAdvantagedCategoryById: Map<string, TaxAdvantagedCategory>
  displayCurrency: string
  isArchived?: boolean
}) {
  const barColor = isArchived
    ? 'var(--app-text-muted)'
    : accent === 'positive' ? 'var(--app-positive)' : 'var(--app-negative)'
  const balanceColor =
    isArchived
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
  const linkedPlan = account.group_id === null && account.tax_advantaged_category_id
    ? taxAdvantagedCategoryById.get(account.tax_advantaged_category_id)
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
        isArchived ? 'my-1 border border-dashed opacity-75 hover:opacity-100' : ''
      }`}
      style={isArchived ? { borderColor: 'var(--app-border)' } : undefined}
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
            {isArchived && (
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
            <div className="mt-0.5 flex items-center gap-1.5 min-[730px]:justify-end">
              <p
                className="font-financial text-xs"
                style={{ color: fxStatus.state === 'complete' ? 'var(--app-text-muted)' : 'var(--app-negative)' }}
              >
                {convertedBalanceText}
              </p>
              <FxStatusBadge
                label="Account balance FX status"
                fxStatus={fxStatus}
                getMessage={getAccountBalanceFxStatusMessage}
              />
            </div>
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
