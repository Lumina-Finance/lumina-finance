import type { ReactNode } from 'react'
import { formatCurrency } from '@/utils/formatCurrency'

export type MerchantRankingRow = {
  id: string
  name: string
  totalAmount: number
  transactionCount: number
  averageAmount: number
  changePct: number | null
}

type MerchantRankingCardProps = {
  header: ReactNode
  merchants: MerchantRankingRow[]
  currency: string
  emptyLabel?: string
}

function getChangeColor(changePct: number | null) {
  if (changePct === null) return 'var(--app-text-muted)'
  if (changePct > 0) return 'var(--app-chart-negative)'
  if (changePct < 0) return 'var(--app-chart-positive)'
  return 'var(--app-text-muted)'
}

function getChangeLabel(changePct: number | null) {
  if (changePct === null) return 'New'
  return `${changePct > 0 ? '+' : ''}${changePct}%`
}

export function MerchantRankingCard({
  header,
  merchants,
  currency,
  emptyLabel = 'No merchant spending in this range.',
}: MerchantRankingCardProps) {
  return (
    <div className="app-card">
      {header}
      {merchants.length > 0 ? (
        <div className="space-y-3">
          {merchants.map((merchant, index) => (
            <div key={merchant.id} className="flex items-center gap-3">
              <span
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold"
                style={{ background: 'var(--app-accent-soft)', color: 'var(--app-accent)' }}
              >
                {index + 1}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold">
                  {merchant.name}
                </p>
                <p className="text-xs" style={{ color: 'var(--app-text-muted)' }}>
                  {merchant.transactionCount} transactions | avg {formatCurrency(merchant.averageAmount, currency)}
                </p>
              </div>
              <div className="text-right">
                <p className="font-financial text-sm">
                  {formatCurrency(merchant.totalAmount, currency)}
                </p>
                <p
                  className="font-financial text-xs"
                  style={{ color: getChangeColor(merchant.changePct) }}
                >
                  {getChangeLabel(merchant.changePct)}
                </p>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="flex min-h-24 items-center justify-center rounded-lg border border-dashed border-[var(--app-border)] text-sm" style={{ color: 'var(--app-text-muted)' }}>
          {emptyLabel}
        </div>
      )}
    </div>
  )
}
