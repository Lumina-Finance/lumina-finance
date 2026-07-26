import type { AccountsOverview } from '@/api/accounts'
import type { TaxAdvantagedCategory } from '@/api/tax-advantaged-categories'
import { formatCurrency } from '@/utils/formatCurrency'

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
 */
export default function TaxAdvantagedAccountLinksPanel({
  accountError,
  bindableAccounts,
  linkedAccountsCount,
  onToggleAccount,
  pendingAccountId,
  plan,
}: TaxAdvantagedAccountLinksPanelProps) {
  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      <div className="shrink-0">
        <p className="text-[0.9375rem]" style={{ color: 'var(--app-text-muted)' }}>
          Choose eligible {plan.currency} accounts for this category. Archived accounts stay visible for history but cannot be linked or unlinked until unarchived.
        </p>
      </div>

      {accountError && (
        <p className="shrink-0 text-sm" style={{ color: 'var(--app-negative)' }}>
          {accountError}
        </p>
      )}

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
            const disabled = account.is_archived || linkedElsewhere || pending
            const statusParts = [
              account.institution?.name ?? 'Cash',
              account.is_archived ? 'Archived' : null,
              linkedElsewhere ? 'Linked elsewhere' : null,
            ].filter((part): part is string => part !== null)

            return (
              <label
                key={account.id}
                className={`grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 px-4 py-3 text-sm transition-colors duration-150 ${disabled ? 'cursor-not-allowed' : 'cursor-pointer hover:bg-[var(--app-accent-soft)]'}`}
                style={{
                  borderTop: index === 0 ? 'none' : '1px solid var(--app-border)',
                  opacity: account.is_archived || linkedElsewhere ? 0.55 : 1,
                }}
              >
                <input
                  type="checkbox"
                  checked={linked}
                  onChange={() => onToggleAccount(account)}
                  disabled={disabled}
                  aria-label={`${linked ? 'Unlink' : 'Link'} ${account.name}`}
                  className="h-4 w-4 cursor-pointer disabled:cursor-not-allowed"
                  style={{ accentColor: 'var(--app-accent)' }}
                />
                <span className="min-w-0">
                  <span className="block truncate font-medium">{account.name}</span>
                  <span className="block truncate text-xs" style={{ color: 'var(--app-text-muted)' }}>
                    {statusParts.join(' · ')}
                  </span>
                </span>
                <span className="font-financial text-sm">
                  {formatCurrency(account.current_balance, account.currency)}
                </span>
              </label>
            )
          })}
        </div>
      )}

      <p className="shrink-0 text-sm" style={{ color: 'var(--app-text-muted)' }}>
        {linkedAccountsCount} of {bindableAccounts.length} linked
      </p>
    </div>
  )
}
