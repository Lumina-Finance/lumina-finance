import { Archive, Check } from 'lucide-react'
import type { AccountsOverview } from '@/api/accounts'
import MarqueeText from '@/components/display/MarqueeText'
import { formatCurrency } from '@/utils/formatCurrency'

interface ArchivedRunwayAccountTileProps {
  account: AccountsOverview
}

interface RunwayAccountTileProps {
  account: AccountsOverview
  selected: boolean
  onToggle: () => void
}

/**
 * Shows an archived account that was previously included in runway settings
 */
export function ArchivedRunwayAccountTile({ account }: ArchivedRunwayAccountTileProps) {
  const institutionName = account.institution?.name ?? 'Cash'

  return (
    <div
      className="app-marquee-trigger flex w-full min-w-0 items-center gap-3 overflow-hidden rounded-xl px-3 py-2.5 text-left"
      style={{
        background: 'var(--app-input-bg)',
        border: '1px solid var(--app-input-border)',
        opacity: 0.6,
      }}
    >
      <span
        className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md"
        style={{
          background: 'transparent',
          border: '1px solid var(--app-border-strong)',
          color: 'var(--app-text-muted)',
        }}
      >
        <Archive size={12} aria-hidden />
      </span>
      <span className="min-w-0 flex-1 overflow-hidden">
        <MarqueeText active className="font-medium">{account.name}</MarqueeText>
        <span className="block text-xs truncate" style={{ color: 'var(--app-text-muted)' }}>
          {institutionName} · Archived
        </span>
      </span>
      <span className="shrink-0 text-right tabular-nums">
        <span className="block font-financial text-sm font-medium" style={{ color: 'var(--app-text-muted)' }}>
          {formatCurrency(account.current_balance, account.currency)}
        </span>
      </span>
    </div>
  )
}

/**
 * Renders an eligible runway account as a selectable settings row
 */
export function RunwayAccountTile({ account, selected, onToggle }: RunwayAccountTileProps) {
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
