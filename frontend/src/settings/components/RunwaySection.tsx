import { Check } from 'lucide-react'
import type React from 'react'
import type { AccountsOverview } from '@/api/accounts'
import MarqueeText from '@/components/MarqueeText'
import { formatCurrency } from '@/utils/formatCurrency'
import SectionHeader from '@/settings/components/SectionHeader'
import SettingsCard from '@/settings/components/SettingsCard'

/* ── Runway ── */

interface RunwaySectionProps {
  loading: boolean
  accounts: AccountsOverview[]
  selection: Set<string>
  onToggle: (id: string) => void
  actions: React.ReactNode
}

export default function RunwaySection({ loading, accounts, selection, onToggle, actions }: RunwaySectionProps) {
  return (
    <section id="runway" className="scroll-mt-8">
      <SectionHeader
        title="Runway"
        description={
          <>
            <p>
              Pick which accounts should count toward calculating your runway — how long the total balance in the selected accounts will last assuming your average monthly spend for the last 12 months (or the maximum available history) doesn't change. Only open asset accounts are eligible; liabilities like credit cards or loans can't be counted.
            </p>
            <p>
              For example, if your selected accounts hold $30,000 and you've averaged $5,000 a month in spending, that's a 6-month runway.
            </p>
          </>
        }
      />

      <SettingsCard>
        <div className="space-y-4">
          {loading ? null : accounts.length === 0 ? (
            <p className="py-3 text-center italic text-sm" style={{ color: 'var(--app-text-subtle)' }}>
              No eligible accounts yet. Add an asset account to configure runway.
            </p>
          ) : (
            <div className="space-y-4">
              <div className="grid gap-2 min-[1500px]:grid-cols-2">
                {accounts.map((account) => (
                  <RunwayAccountTile
                    key={account.id}
                    account={account}
                    selected={selection.has(account.id)}
                    onToggle={() => onToggle(account.id)}
                  />
                ))}
              </div>
              <p className="text-xs" style={{ color: 'var(--app-text-subtle)' }}>
                {selection.size} of {accounts.length} selected
              </p>
            </div>
          )}
          {actions}
        </div>
      </SettingsCard>
    </section>
  )
}

function RunwayAccountTile({
  account,
  selected,
  onToggle,
}: {
  account: AccountsOverview
  selected: boolean
  onToggle: () => void
}) {
  const institutionName = account.institution?.name ?? 'Cash'
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={selected}
      onClick={onToggle}
      className="app-marquee-trigger flex w-full min-w-0 items-center gap-3 overflow-hidden rounded-xl px-3 py-2.5 text-left transition-colors duration-200"
      style={{
        background: selected ? 'var(--app-accent-soft)' : 'var(--app-input-bg)',
        border: `1px solid ${selected ? 'var(--app-accent-border)' : 'var(--app-input-border)'}`,
      }}
    >
      <span
        className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md"
        style={{
          background: selected ? 'var(--app-accent)' : 'transparent',
          border: `1px solid ${selected ? 'var(--app-accent)' : 'var(--app-border-strong)'}`,
          color: '#1C1510',
        }}
      >
        {selected && <Check size={13} strokeWidth={3} aria-hidden />}
      </span>
      <span className="min-w-0 flex-1 overflow-hidden">
        <MarqueeText active className="font-medium">{account.name}</MarqueeText>
        <span className="block text-xs truncate" style={{ color: 'var(--app-text-muted)' }}>
          {institutionName}
        </span>
      </span>
      <span className="shrink-0 text-right tabular-nums">
        <span
          className="block font-financial text-sm font-medium"
          style={{
            color:
              account.current_balance > 0
                ? 'var(--app-positive)'
                : account.current_balance < 0
                  ? 'var(--app-negative)'
                  : 'var(--app-text)',
          }}
        >
          {formatCurrency(account.current_balance, account.currency)}
        </span>
        {account.credit_limit !== null && (
          <span
            className="block font-financial text-xs"
            style={{ color: 'var(--app-text-muted)' }}
          >
            {formatCurrency(account.credit_limit + account.current_balance, account.currency)} avail.
          </span>
        )}
      </span>
    </button>
  )
}
