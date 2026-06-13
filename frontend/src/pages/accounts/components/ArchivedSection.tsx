import { useState } from 'react'
import { ChevronDown, EyeOff } from 'lucide-react'
import type { AccountsOverview } from '@/api/accounts'
import type { TaxAdvantagedCategory } from '@/api/taxAdvantagedCategories'
import AccountRow from '@/pages/accounts/components/Row'

export default function ArchivedAccountsSection({
  accounts,
  taxAdvantagedCategoryById,
  displayCurrency,
}: {
  accounts: AccountsOverview[]
  taxAdvantagedCategoryById: Map<string, TaxAdvantagedCategory>
  displayCurrency: string
}) {
  const [expanded, setExpanded] = useState(false)

  if (accounts.length === 0) return null

  return (
    <section>
      <button
        type="button"
        className="flex w-full items-center gap-3 py-2 text-left transition-colors hover:text-[var(--app-text)]"
        style={{
          borderTop: '1px solid var(--app-border)',
          color: 'var(--app-text-muted)',
        }}
        aria-expanded={expanded}
        onClick={() => setExpanded((value) => !value)}
      >
        <EyeOff size={16} aria-hidden />
        <span className="font-medium">Archived accounts</span>
        <span
          className="rounded-full px-2 py-0.5 text-xs font-semibold"
          style={{ background: 'var(--app-accent-soft)' }}
        >
          {accounts.length}
        </span>
        <ChevronDown
          size={16}
          className={`ml-auto transition-transform ${expanded ? 'rotate-180' : ''}`}
          aria-hidden
        />
      </button>

      {expanded && (
        <div className="pt-1">
          {accounts.map((account) => (
            <AccountRow
              key={account.id}
              account={account}
              accent={account.account_kind === 'asset' ? 'positive' : 'negative'}
              showCreditLimit={account.account_kind === 'revolving'}
              taxAdvantagedCategoryById={taxAdvantagedCategoryById}
              displayCurrency={displayCurrency}
              isArchived
            />
          ))}
        </div>
      )}
    </section>
  )
}
