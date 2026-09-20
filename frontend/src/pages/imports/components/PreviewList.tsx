import TransactionRow, { TransactionRowView } from '@/components/transactions/Row'
import type { ExactPreviewTransaction, PreviewTransactionRow } from '@/pages/imports/types'
import type { Transaction } from '@/api/transactions'
import { useMoneyFormatters } from '@/hooks/useMoneyFormatters'
import { formatPreviewMoney } from '@/pages/imports/utils/formatPreviewMoney'

/** Distinguishes exact generic previews from the existing numeric Firefly previews */
function isExactPreview(transaction: Transaction | ExactPreviewTransaction): transaction is ExactPreviewTransaction {
  return typeof transaction.amount === 'bigint'
}

/**
 * Renders preview transactions with the ledger's date-group presentation
 *
 * The shared transaction row lays its desktop cells out with a CSS subgrid,
 * so the wrapper must define the same column tracks the transactions page
 * uses or the cells collapse into a vertical stack on wide viewports
 */
export function ImportPreviewList({
  groups,
}: {
  groups: Array<{ dateLabel: string; rows: PreviewTransactionRow[] }>
}) {
  const { currencies } = useMoneyFormatters()
  // The wrapper scrolls sideways only below the width the row layout is built for. Past that it
  // stops clipping entirely, because overflow-x cannot be auto while overflow-y stays visible, and
  // clipping vertically cuts off the tag stack that opens above a row
  return (
    <div className="overflow-x-auto min-[1300px]:overflow-visible">
      <div className="min-w-[58rem] min-[1300px]:grid min-[1300px]:grid-cols-[2.75rem_fit-content(24rem)_fit-content(18rem)_minmax(0,1fr)_max-content_max-content] min-[1300px]:gap-x-3">
        {groups.map((group, groupIndex) => (
          <div
            key={`${group.dateLabel}-${groupIndex}`}
            className="min-[1300px]:col-span-full min-[1300px]:grid min-[1300px]:grid-cols-subgrid"
          >
            <div
              className="flex items-center justify-between rounded-lg px-3 py-2 min-[1300px]:col-span-full"
              style={{
                background: 'var(--app-input-bg)',
                borderBottom: '1px solid var(--app-border)',
              }}
            >
              <p
                className="text-sm font-semibold uppercase tracking-wide"
                style={{ color: 'var(--app-text-subtle)' }}
              >
                {group.dateLabel}
              </p>
            </div>

            {group.rows.map((row) => {
              const props = {
                accountInstitution: row.accountInstitution,
                accountName: row.accountName,
                category: row.category,
                counterpartyAccountName: row.counterpartyAccountName,
                skipEnterAnimation: true,
                onOpen: () => undefined,
              }
              return isExactPreview(row.transaction)
                ? <TransactionRowView key={row.id} {...props} transaction={row.transaction} amountPresentation={formatPreviewMoney(row.transaction.amount, row.currency, currencies)} />
                : <TransactionRow key={row.id} {...props} currency={row.currency} transaction={row.transaction} />
            })}
          </div>
        ))}
      </div>
    </div>
  )
}
