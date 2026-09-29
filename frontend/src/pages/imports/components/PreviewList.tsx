import { useMemo, useState } from 'react'
import TransactionRow, { TransactionRowView } from '@/components/transactions/Row'
import { TRANSACTION_LIST_SUBGRID } from '@/components/transactions/listLayout'
import { UpcomingSection } from '@/components/transactions/UpcomingSection'
import type { ExactPreviewTransaction, PreviewTransactionRow } from '@/pages/imports/types'
import type { Transaction } from '@/api/transactions'
import { useMoneyFormatters } from '@/hooks/useMoneyFormatters'
import { useTodayYmd } from '@/hooks/useTodayYmd'
import { formatPreviewMoney } from '@/pages/imports/utils/formatPreviewMoney'
import { splitUpcoming } from '@/utils/upcoming'

type PreviewGroup = { dateLabel: string; rows: PreviewTransactionRow[] }

/** Distinguishes exact generic previews from the numeric Firefly III and Actual Budget previews */
function isExactPreview(transaction: Transaction | ExactPreviewTransaction): transaction is ExactPreviewTransaction {
  return typeof transaction.amount === 'bigint'
}

/**
 * Renders preview transactions with the ledger's date-group presentation, gathering the days after the
 * user's today into the collapsed Upcoming section the ledger uses
 *
 * The shared transaction row lays its desktop cells out with a CSS subgrid,
 * so the wrapper must define the same column tracks the transactions page
 * uses or the cells collapse into a vertical stack on wide viewports
 */
export function ImportPreviewList({
  groups,
}: {
  groups: PreviewGroup[]
}) {
  const { currencies } = useMoneyFormatters()
  const today = useTodayYmd()
  const [isUpcomingExpanded, setIsUpcomingExpanded] = useState(false)

  // Every row in a group shares its day, so the first row's date places the whole group
  const { upcoming: upcomingGroups, rest: pastGroups } = useMemo(
    () => splitUpcoming(groups, (group) => group.rows[0]?.transaction.dt ?? '', today),
    [groups, today],
  )
  // A section that empties closes, so it comes back collapsed as it first appeared
  if (upcomingGroups.length === 0 && isUpcomingExpanded) setIsUpcomingExpanded(false)

  function renderGroups(shownGroups: PreviewGroup[]) {
    return shownGroups.map((group, groupIndex) => (
      <div key={`${group.dateLabel}-${groupIndex}`} className={TRANSACTION_LIST_SUBGRID}>
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
    ))
  }

  // The wrapper scrolls sideways only below the width the row layout is built for. Past that it
  // stops clipping entirely, because overflow-x cannot be auto while overflow-y stays visible, and
  // clipping vertically cuts off the tag stack that opens above a row. It is a size container so the
  // Upcoming header and explanation can fit its visible width rather than the rows' full width
  return (
    <div className="@container overflow-x-auto min-[1300px]:overflow-visible">
      <div className="min-w-[58rem] min-[1300px]:grid min-[1300px]:grid-cols-[2.75rem_fit-content(24rem)_fit-content(18rem)_minmax(0,1fr)_max-content_max-content] min-[1300px]:gap-x-3">
        <UpcomingSection
          transactionDates={upcomingGroups.flatMap((group) => group.rows.map((row) => row.transaction.dt))}
          today={today}
          expanded={isUpcomingExpanded}
          onToggle={() => setIsUpcomingExpanded((current) => !current)}
          gridClassName={TRANSACTION_LIST_SUBGRID}
        >
          {renderGroups(upcomingGroups)}
        </UpcomingSection>
        {renderGroups(pastGroups)}
      </div>
    </div>
  )
}
