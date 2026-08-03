import TransactionRow from '@/components/transactions/Row'
import type { PreviewTransactionRow } from '@/pages/imports/types'

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
  return (
    <div className="overflow-x-auto">
      <div className="min-w-[58rem] min-[1300px]:grid min-[1300px]:grid-cols-[2.5rem_fit-content(24rem)_fit-content(18rem)_minmax(0,1fr)_max-content_max-content] min-[1300px]:gap-x-3">
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

            {group.rows.map((row) => (
              <TransactionRow
                key={row.id}
                accountInstitution={row.accountInstitution}
                accountName={row.accountName}
                category={row.category}
                currency={row.currency}
                transaction={row.transaction}
                counterpartyAccountName={row.counterpartyAccountName}
                skipEnterAnimation
                onOpen={() => undefined}
              />
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}
