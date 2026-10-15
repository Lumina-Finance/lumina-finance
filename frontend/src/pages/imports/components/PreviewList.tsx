import { useMemo, useState } from 'react'
import TransactionRow, { TransactionRowView } from '@/components/transactions/Row'
import { TRANSACTION_LIST_COLUMNS, TRANSACTION_LIST_SUBGRID } from '@/components/transactions/listLayout'
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
 * The shared transaction row lays its cells out with a CSS subgrid from 750px
 * wide, so the wrapper must define the same column tracks the transactions page
 * uses or the cells collapse into a vertical stack
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
          className="flex items-center justify-between rounded-lg px-3 py-2 min-[750px]:col-span-full"
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

  // The rows fit any width, giving up their tag names and then their note's text to icons as room runs
  // out. Nothing clips, so the tag stack that opens above a row shows in full. It is a size container
  // so the Upcoming header and explanation fit its width
  return (
    <div className="@container">
      <div className={TRANSACTION_LIST_COLUMNS}>
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
