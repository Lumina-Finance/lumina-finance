import type { CSSProperties } from 'react'
import { Link } from 'react-router'
import { EyeOff } from 'lucide-react'
import type { AccountsOverview } from '@/api/accounts'
import type { TaxAdvantagedCategory } from '@/api/tax-advantaged-categories'
import { FxStatusBadge } from '@/components/tooltips/FxStatusBadge'
import { useMoneyFormatters } from '@/hooks/useMoneyFormatters'
import { useFittedForm } from '@/pages/accounts/hooks/useFittedForm'
import { getAvailableCreditForms } from '@/pages/accounts/utils/availableCreditForms'
import { InstitutionLogo } from '@/pages/accounts/components/InstitutionLogo'
import { AccountTypeMark } from '@/pages/accounts/components/GroupMark'
import { InstitutionMark } from '@/pages/accounts/components/InstitutionMark'
import { TaxAdvantagedTag } from '@/pages/accounts/components/TaxAdvantagedTag'
import { humanizeAccountType } from '@/utils/formatAccountType'
import type { AccountAccent } from '@/pages/accounts/types/accounts'
import { getAccountBalanceFxStatusMessage } from '@/pages/accounts/utils/fxTooltipMessages'
import { getColorOnAccentTint, getSignedAmountColor } from '@/utils/negativeAmount'

/**
 * One account in a list, linking to its detail page and showing the institution logo, name, any
 * linked tax-advantaged plan, the balance in the account's own currency and, where the list asks
 * for it, the credit still available
 *
 * The balance is tinted by whether it helps or hurts the reader rather than by its sign alone, so
 * an asset account turns green only above zero while a debt account is never green. Where the
 * account is held in another currency, the converted amount sits underneath and reads as
 * unavailable when the exchange rates behind it are incomplete
 */
export default function AccountRow({
  account,
  accent,
  showCreditLimit,
  taxAdvantagedCategoryById,
  displayCurrency,
  isArchived = false,
  isBare = false,
  showBankLogo = false,
  showTypeIcon = false,
  meta,
}: {
  account: AccountsOverview
  accent: AccountAccent
  showCreditLimit: boolean
  taxAdvantagedCategoryById: Map<string, TaxAdvantagedCategory>
  displayCurrency: string
  isArchived?: boolean
  // A bare row drops its accent bar and logo, for a list whose group header already carries them
  isBare?: boolean
  // Puts the bank's small round logo before the name of a bare row
  showBankLogo?: boolean
  // Puts the account type's icon before the name of a bare row, for a list whose groups name the bank
  // but not the type
  showTypeIcon?: boolean
  // Replaces the second line, for a list whose grouping already says the type or the institution
  meta?: string
}) {
  const { formatCurrency, currencies } = useMoneyFormatters()
  const barColor = isArchived
    ? 'var(--app-text-muted)'
    : accent === 'positive'
      ? 'var(--app-positive)'
      : 'var(--app-negative)'
  const balanceColor = isArchived
    ? 'var(--app-text-muted)'
    : accent === 'positive'
      ? getSignedAmountColor(account.current_balance)
      : account.current_balance < 0
        ? 'var(--app-negative)'
        : 'var(--app-text)'
  // The balance reads its colour, and a tinted variant while the row is under the pointer
  const balanceStyle = {
    '--balance-text': balanceColor,
    '--balance-tinted-text': getColorOnAccentTint(balanceColor),
  } as CSSProperties
  const linkedPlan =
    account.group_id === null && account.tax_advantaged_category_id
      ? taxAdvantagedCategoryById.get(account.tax_advantaged_category_id)
      : undefined
  const metadataLabel =
    meta ?? `${humanizeAccountType(account.account_type)}${account.institution ? ` · ${account.institution.name}` : ''}`
  const fxStatus = account.current_balance_fx_status
  const showConvertedBalance = fxStatus.state !== 'none'
  const convertedBalanceText =
    fxStatus.state === 'complete' && account.base_currency_current_balance !== null
      ? `≈ ${formatCurrency(account.base_currency_current_balance, displayCurrency)}`
      : 'FX unavailable'
  const availableCredit =
    showCreditLimit && account.credit_limit !== null ? account.credit_limit + account.current_balance : null
  const availableCreditText =
    availableCredit === null ? null : `${formatCurrency(availableCredit, account.currency)} avail.`
  const availableCreditForms =
    availableCredit === null
      ? null
      : getAvailableCreditForms(
          availableCredit,
          account.currency,
          currencies,
          formatCurrency(availableCredit, account.currency),
        )
  const [setMetaLine, fittedForm] = useFittedForm(availableCreditForms ?? [])

  return (
    <Link
      to={`/accounts/${account.id}`}
      className={`group/row app-focus-inset focus-visible:bg-transparent! flex min-w-0 items-stretch overflow-hidden rounded-xl hover:bg-[var(--app-accent-soft)] ${
        isArchived
          ? 'my-1 border border-dashed opacity-75 transition-[color,background-color,opacity] hover:opacity-100'
          : 'transition-control'
      }`}
      style={isArchived ? { borderColor: 'var(--app-border)' } : undefined}
    >
      {!isBare && <div className="my-3 ml-0.5 w-0.5 rounded-full" style={{ background: barColor, opacity: 0.3 }} />}
      {/* On a phone the row is a grid of lines: the name beside the balance, then the type or bank
          beside the converted amount, then any credit still available. A long name or bank wraps rather
          than being cut short */}
      <div
        className={`grid min-w-0 flex-1 items-baseline gap-x-3 gap-y-0.5 py-3.5 min-[750px]:flex min-[750px]:items-center min-[750px]:gap-4 ${
          isBare
            ? 'grid-cols-[minmax(0,1fr)_auto] px-2'
            : 'grid-cols-[2.25rem_minmax(0,1fr)_auto] px-3 min-[750px]:px-4'
        }`}
      >
        {!isBare && (
          <div className="row-span-3 shrink-0 self-center">
            <InstitutionLogo institution={account.institution} />
          </div>
        )}
        <div className="contents min-[750px]:block min-[750px]:min-w-0 min-[750px]:flex-1 min-[750px]:overflow-hidden">
          {/* The bank's mark keeps a column of its own, so a wrapped name's lines all start together */}
          <div
            className={`${isBare ? 'col-start-1' : 'col-start-2'} row-start-1 flex min-w-0 items-baseline gap-2 min-[750px]:items-center`}
          >
            {isBare && showBankLogo && account.institution && (
              <span className="mt-0.5 flex shrink-0 self-start min-[750px]:mt-0 min-[750px]:self-center">
                <InstitutionMark institution={account.institution} size="row" />
              </span>
            )}
            {isBare && showTypeIcon && (
              <span className="mt-0.5 flex shrink-0 self-start min-[750px]:mt-0 min-[750px]:self-center">
                <AccountTypeMark accountType={account.account_type} />
              </span>
            )}
            {/* On a phone the name and plan tag flow as one line of text, so a wrapped name carries its tag
                after its last word. Wider screens keep them in a row and cut a long name short */}
            <div className="min-w-0 flex-1 min-[750px]:flex min-[750px]:items-center min-[750px]:gap-2">
              <p className="inline font-medium [overflow-wrap:anywhere] min-[750px]:block min-[750px]:min-w-0 min-[750px]:truncate">
                {account.name}
              </p>
              {linkedPlan && (
                <span className="ml-2 inline-flex align-[0.1em] min-[750px]:ml-0 min-[750px]:shrink-0">
                  <TaxAdvantagedTag name={linkedPlan.name} />
                </span>
              )}
            </div>
          </div>
          <div
            className={`${isBare ? 'col-start-1' : 'col-start-2'} row-start-2 flex min-w-0 items-center gap-2 min-[750px]:mt-0.5`}
          >
            {isArchived && (
              <EyeOff size={13} className="shrink-0" style={{ color: 'var(--app-text-muted)' }} aria-hidden />
            )}
            <p
              ref={setMetaLine}
              className="min-w-0 flex-1 text-sm [overflow-wrap:anywhere] min-[750px]:flex-none min-[750px]:truncate"
              style={{ color: 'var(--app-text-muted)' }}
            >
              {metadataLabel}
              {/* On a phone the credit still available follows the type, shortened to the longest form
                  that keeps the line from wrapping, and left out when none does */}
              {availableCreditForms && (
                <span data-fitted-form className={`min-[750px]:hidden ${fittedForm === -1 ? 'hidden' : ''}`}>
                  {' · '}
                  <span data-fitted-form-text data-credit-available className="font-financial">
                    {availableCreditForms[Math.max(fittedForm, 0)]}
                  </span>
                </span>
              )}
            </p>
          </div>
        </div>
        <div className="contents text-right min-[750px]:block min-[750px]:shrink-0">
          <p
            className={`${isBare ? 'col-start-2' : 'col-start-3'} row-start-1 justify-self-end font-financial font-medium text-[var(--balance-text)] transition-control group-hover/row:text-[var(--balance-tinted-text)]`}
            style={balanceStyle}
          >
            {formatCurrency(account.current_balance, account.currency)}
          </p>
          {showConvertedBalance && (
            <div
              className={`${isBare ? 'col-start-2' : 'col-start-3'} row-start-2 flex items-center justify-end gap-1.5 justify-self-end min-[750px]:mt-0.5`}
            >
              <p
                className="whitespace-nowrap font-financial text-xs"
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
          {/* Wider screens keep the credit still available under the balance. A phone puts it beside the type */}
          {availableCreditText && (
            <p
              className="hidden font-financial text-xs min-[750px]:mt-0.5 min-[750px]:block"
              style={{ color: 'var(--app-text-muted)' }}
            >
              {availableCreditText}
            </p>
          )}
        </div>
      </div>
    </Link>
  )
}
