import { useId } from 'react'
import { TriangleAlert } from 'lucide-react'
import type { AccountsOverview } from '@/api/accounts'
import { FormError } from '@/components/forms/FormError'
import { InfoCallout } from '@/components/InfoCallout'
import { ReadOnlyReasonPill } from '@/components/tooltips/ReadOnlyReasonPill'
import type { TaxAdvantagedCategory } from '@/api/tax-advantaged-categories'
import { useMoneyFormatters } from '@/hooks/useMoneyFormatters'

interface TaxAdvantagedAccountLinksPanelProps {
  accountError: string | null
  bindableAccounts: AccountsOverview[]
  linkedAccountsCount: number
  onToggleAccount: (account: AccountsOverview) => void
  pendingAccountId: string | null
  plan: TaxAdvantagedCategory
}

/**
 * Renders the TAC account-linking tab for eligible same-currency asset accounts
 *
 * Linking or unlinking changes the account, so the toggles are held back while the server keeps the
 * category read-only, with its reason above the list, and on each account it keeps read-only, with the
 * reason in a pill on that account's row
 */
export default function TaxAdvantagedAccountLinksPanel({
  accountError,
  bindableAccounts,
  linkedAccountsCount,
  onToggleAccount,
  pendingAccountId,
  plan,
}: TaxAdvantagedAccountLinksPanelProps) {
  const { formatCurrency } = useMoneyFormatters()
  const planReasonId = useId()
  const rowReasonIdPrefix = useId()

  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      <div className="shrink-0">
        <p className="text-[0.9375rem]" style={{ color: 'var(--app-text-muted)' }}>
          Choose eligible {plan.currency} accounts for this category. Archived accounts stay visible for history but
          cannot be linked or unlinked until unarchived.
        </p>
      </div>

      {plan.read_only_reason && (
        <div className="shrink-0">
          <InfoCallout tone="stopped" icon={TriangleAlert}>
            <span id={planReasonId}>{plan.read_only_reason}</span>
          </InfoCallout>
        </div>
      )}

      <FormError message={accountError} className="shrink-0" />

      {bindableAccounts.length === 0 ? (
        <p className="min-h-0 flex-1 py-3 text-sm italic" style={{ color: 'var(--app-text-subtle)' }}>
          No eligible {plan.currency} asset accounts.
        </p>
      ) : (
        <div
          className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden rounded-xl border"
          style={{ borderColor: 'var(--app-border)' }}
        >
          {bindableAccounts.map((account, index) => {
            const linked = account.tax_advantaged_category_id === plan.id
            const linkedElsewhere = account.tax_advantaged_category_id !== null && !linked
            const pending = pendingAccountId === account.id
            const accountReasonId = `${rowReasonIdPrefix}-${account.id}`
            const reasonId = plan.read_only_reason
              ? planReasonId
              : account.read_only_reason
                ? accountReasonId
                : undefined
            const disabled = account.is_archived || linkedElsewhere || pending || reasonId !== undefined
            const statusParts = [
              account.institution?.name ?? 'Cash',
              account.is_archived ? 'Archived' : null,
              linkedElsewhere ? 'Linked elsewhere' : null,
            ].filter((part): part is string => part !== null)

            return (
              <label
                key={account.id}
                className={`grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 px-4 py-3 text-sm transition-colors ${disabled ? 'cursor-not-allowed' : 'cursor-pointer hover:bg-[var(--app-accent-soft)]'}`}
                style={{
                  borderTop: index === 0 ? 'none' : '1px solid var(--app-border)',
                  opacity: account.is_archived || linkedElsewhere || reasonId ? 0.55 : 1,
                }}
              >
                <input
                  type="checkbox"
                  checked={linked}
                  onChange={() => onToggleAccount(account)}
                  disabled={disabled}
                  aria-label={`${linked ? 'Unlink' : 'Link'} ${account.name}`}
                  aria-describedby={reasonId}
                  className="h-4 w-4 cursor-pointer disabled:cursor-not-allowed"
                  style={{ accentColor: 'var(--app-accent)' }}
                />
                <span className="min-w-0">
                  <span className="block truncate font-medium">{account.name}</span>
                  <span className="block truncate text-xs" style={{ color: 'var(--app-text-muted)' }}>
                    {statusParts.join(' · ')}
                  </span>
                  {!plan.read_only_reason && account.read_only_reason && (
                    <span className="mt-1 flex min-w-0">
                      <ReadOnlyReasonPill id={accountReasonId} reason={account.read_only_reason} focusable />
                    </span>
                  )}
                </span>
                <span className="font-financial text-sm">
                  {formatCurrency(account.current_balance, account.currency)}
                </span>
              </label>
            )
          })}
        </div>
      )}

      <p data-toast-keep-clear className="w-fit shrink-0 text-sm" style={{ color: 'var(--app-text-muted)' }}>
        {linkedAccountsCount} of {bindableAccounts.length} linked
      </p>
    </div>
  )
}
