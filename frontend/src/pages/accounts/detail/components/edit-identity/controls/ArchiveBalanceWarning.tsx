import { AlertTriangle } from 'lucide-react'
import { useMoneyFormatters } from '@/hooks/useMoneyFormatters'

type ArchiveBalanceWarningProps = {
  balance: number
  currency: string
}

/**
 * Explains the generated balance adjustment before an active account is archived
 */
export function ArchiveBalanceWarning({
  balance,
  currency,
}: ArchiveBalanceWarningProps) {
  const { formatCurrency } = useMoneyFormatters()
  const adjustmentAmount = -balance
  const hasBalance = balance !== 0

  return (
    <div
      className="rounded-lg px-3 py-2.5"
      style={{
        background: 'var(--app-warning-soft)',
        border: '1px solid var(--app-border)',
      }}
    >
      <div className="flex gap-2.5">
        <div
          className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md"
          style={{ background: 'var(--app-bg)', color: 'var(--app-warning)' }}
        >
          <AlertTriangle size={13} aria-hidden />
        </div>
        <div className="min-w-0">
          <p className="text-sm font-semibold leading-5">Balance will be set to zero</p>
          <p className="mt-0.5 text-sm leading-5" style={{ color: 'var(--app-text-muted)' }}>
            {hasBalance
              ? `${formatCurrency(adjustmentAmount, currency)} will be recorded as a Balance Adjustment with note "Account archived". Unarchiving will not restore the previous balance.`
              : 'This account already has a zero balance, so no balance adjustment will be recorded.'}
          </p>
        </div>
      </div>
    </div>
  )
}
