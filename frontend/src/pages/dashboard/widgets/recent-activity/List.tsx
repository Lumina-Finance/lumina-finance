import { Link } from 'react-router'
import { formatDashboardShortDate } from '@/pages/dashboard/utils/formatDashboardShortDate'
import type { RecentActivityRow } from '@/pages/dashboard/utils/getRecentActivityRows'
import { useMoneyFormatters } from '@/hooks/useMoneyFormatters'

type RecentActivityListProps = {
  rows: RecentActivityRow[]
}

type RecentActivityRowProps = {
  row: RecentActivityRow
  showDivider: boolean
}

/**
 * Renders one recent transaction row with category metadata and signed amount
 */
function RecentActivityRowItem({ row, showDivider }: RecentActivityRowProps) {
  const { formatCurrency } = useMoneyFormatters()
  const { transaction, category, title, isIncome } = row

  return (
    <div
      className="flex items-center justify-between gap-2 py-2.5"
      style={
        showDivider
          ? { borderBottom: '1px solid var(--app-border)' }
          : undefined
      }
    >
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium max-[1000px]:text-[0.7875rem]">
          {title}
          {category && (
            <>
              <span className="mx-1.5" style={{ color: 'var(--app-text-subtle)' }}>·</span>
              <span style={{ color: 'var(--app-text-muted)' }}>{category.name}</span>
            </>
          )}
        </p>
        <p
          className="mt-0.5 text-xs max-[1000px]:text-[0.675rem]"
          style={{ color: 'var(--app-text-muted)' }}
        >
          {formatDashboardShortDate(transaction.dt)}
        </p>
      </div>
      <span
        className="font-financial shrink-0 tabular-nums text-sm font-medium max-[1000px]:text-[0.7875rem]"
        style={{ color: isIncome ? 'var(--app-positive)' : 'var(--app-text)' }}
      >
        {transaction.amount >= 0 ? '+' : '-'}
        {formatCurrency(Math.abs(transaction.amount), transaction.currency)}
      </span>
    </div>
  )
}

/**
 * Renders recent transaction rows, the empty state, and the full transactions link
 */
export function RecentActivityList({ rows }: RecentActivityListProps) {
  if (rows.length === 0) {
    return (
      <div
        className="flex flex-1 items-center justify-center text-sm italic max-[1000px]:text-[0.7875rem]"
        style={{ color: 'var(--app-text-subtle)' }}
      >
        No recent transactions
      </div>
    )
  }

  return (
    <>
      <div className="min-h-0 flex-1">
        {rows.map((row, index) => (
          <RecentActivityRowItem
            key={row.transaction.id}
            row={row}
            showDivider={index < rows.length - 1}
          />
        ))}
      </div>
      <Link
        to="/transactions"
        className="app-secondary-button mt-3 h-9 text-xs max-[1000px]:text-[0.675rem]"
      >
        View all transactions
      </Link>
    </>
  )
}
