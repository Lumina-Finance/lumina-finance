import { AnimatePresence, motion } from 'motion/react'
import type { OutlierTransaction } from '@/api/transactions'
import IconTooltip from '@/components/IconTooltip'
import { formatCurrency } from '@/utils/formatCurrency'

export default function MostExpensiveTransactionsPanel({
  outliers,
  displayCurrency,
  prefersReducedMotion,
  openingOutlierId,
  outlierOpenError,
  onOpenOutlierTransaction,
  className = '',
}: {
  outliers: OutlierTransaction[]
  displayCurrency: string
  prefersReducedMotion: boolean | null
  openingOutlierId: string | null
  outlierOpenError: string | null
  onOpenOutlierTransaction: (transactionId: string) => void
  className?: string
}) {
  return (
    <div className={`flex min-w-0 flex-col ${className}`}>
      <p className="app-label mb-1 inline-flex items-center gap-2">
        Most Expensive Transactions
        <IconTooltip
          label="How most expensive transactions are calculated"
          level="info"
          placement="bottom"
          widthClassName="w-64"
        >
          Shows the three largest expense transactions in the selected period
        </IconTooltip>
      </p>
      <div className="mt-2 flex flex-col gap-2.5">
        <AnimatePresence initial={false} mode="popLayout">
          {outliers.map((transaction) => {
            const loading = openingOutlierId === transaction.id
            const label = transaction.merchant_name ?? transaction.notes ?? 'Unknown'
            return (
              <motion.button
                key={transaction.id}
                layout
                type="button"
                className="flex w-full items-center justify-between gap-3 rounded-md px-2.5 py-2 text-left transition-opacity hover:opacity-85 focus:outline-none focus:ring-2 focus:ring-[var(--app-accent-soft)]"
                style={{
                  borderLeft: '2px solid var(--app-accent)',
                  background: 'var(--app-accent-soft)',
                }}
                aria-busy={loading}
                aria-label={`Edit transaction: ${label}`}
                disabled={openingOutlierId !== null}
                onClick={() => onOpenOutlierTransaction(transaction.id)}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: prefersReducedMotion ? 0 : 0.28 }}
              >
                <p className="truncate min-w-0 text-sm font-medium">
                  {label}
                </p>
                {loading ? (
                  <span
                    className="app-spinner shrink-0"
                    aria-label="Loading transaction"
                    style={{ width: 16, height: 16, borderWidth: 2 }}
                  />
                ) : (
                  <p
                    className="font-financial text-sm font-medium shrink-0"
                    style={{ color: 'var(--app-negative)' }}
                  >
                    {formatCurrency(Math.abs(transaction.amount), displayCurrency)}
                  </p>
                )}
              </motion.button>
            )
          })}
        </AnimatePresence>
        {outlierOpenError && (
          <p className="text-xs" style={{ color: 'var(--app-negative)' }}>
            {outlierOpenError}
          </p>
        )}
      </div>
    </div>
  )
}
