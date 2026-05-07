import { useState } from 'react'
import type { TransactionListFilters } from '@/transactions/types/transactionList'

export function useDateRangeDraft({
  filters,
  setFilter,
}: {
  filters: TransactionListFilters
  setFilter: (patch: Partial<TransactionListFilters>) => void
}) {
  const [pendingFrom, setPendingFrom] = useState(filters.from_date ?? '')
  const [pendingTo, setPendingTo] = useState(filters.to_date ?? '')
  const [syncedRange, setSyncedRange] = useState({
    from: filters.from_date,
    to: filters.to_date,
  })

  // React's recommended "adjust during render" pattern keeps popover drafts in
  // sync with applied filters without adding an extra effect render.
  if (syncedRange.from !== filters.from_date || syncedRange.to !== filters.to_date) {
    setSyncedRange({ from: filters.from_date, to: filters.to_date })
    setPendingFrom(filters.from_date ?? '')
    setPendingTo(filters.to_date ?? '')
  }

  const dateRangeInvalid = !!pendingFrom && !!pendingTo && pendingFrom > pendingTo
  const dateRangeChanged =
    (pendingFrom || undefined) !== filters.from_date ||
    (pendingTo || undefined) !== filters.to_date

  const commitDateRange = () => {
    if (dateRangeInvalid) {
      setPendingFrom(filters.from_date ?? '')
      setPendingTo(filters.to_date ?? '')
      return
    }
    const nextFrom = pendingFrom || undefined
    const nextTo = pendingTo || undefined
    if (nextFrom === filters.from_date && nextTo === filters.to_date) return
    setFilter({ from_date: nextFrom, to_date: nextTo })
  }

  return {
    pendingFrom,
    pendingTo,
    setPendingFrom,
    setPendingTo,
    dateRangeInvalid,
    dateRangeChanged,
    commitDateRange,
  }
}
