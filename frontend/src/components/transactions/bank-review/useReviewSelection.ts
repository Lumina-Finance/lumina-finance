import { useCallback, useMemo } from 'react'
import { useReviewItems, type BankReviewItem } from '@/api/bank-sync'
import type { ReviewRowSelection } from '@/components/transactions/bank-review/ReviewBlock'
import { MAX_BULK_EDIT_TRANSACTIONS } from '@/components/transactions/bulk-edit/constants'
import { isRowSelectable } from '@/components/transactions/bulk-edit/selection'
import { useBulkSelection } from '@/components/transactions/bulk-edit/useBulkSelection'
import { useBankItemScope } from '@/components/transactions/hooks/useBankItemScope'

/**
 * Holds which new items waiting for review a bulk edit or a bulk dismissal covers, beside the
 * ledger transactions the list ticks
 *
 * Reads the same pages the review block shows, so a ticked item stays ticked while the block is
 * closed or scrolled past, and leaves the selection once it is decided anywhere. The ticks empty
 * when the block's accounts change, but not on a search, since a search doesn't narrow the block
 *
 * @param listAccountIds - The accounts the list is filtered or fixed to, empty or absent for every account
 * @param limit - How many items may be ticked. That is what the ledger ticks leave of one bulk edit
 */
export function useReviewSelection(listAccountIds: string[] | undefined, limit: number = MAX_BULK_EDIT_TRANSACTIONS) {
  const { accountIds, isInScope, accountById } = useBankItemScope(listAccountIds)
  const { data: pages, isFetching } = useReviewItems(accountIds, isInScope)

  const newItems = useMemo<BankReviewItem[]>(
    () =>
      isInScope
        ? (pages?.pages ?? [])
            .flatMap((page) => page.items)
            .filter((item) => item.kind === 'new' && accountById.has(item.account_id))
        : [],
    [pages, isInScope, accountById],
  )
  const rows = useMemo(() => newItems.map((item) => ({ id: item.id, isReadOnly: false })), [newItems])
  const requestKey = JSON.stringify(accountIds ?? 'all')
  const selection = useBulkSelection(rows, requestKey, !isFetching, limit)

  const selectedIdsSet = useMemo(() => new Set(selection.selectedIds), [selection.selectedIds])
  const selectedItems = useMemo(
    () => newItems.filter((item) => selectedIdsSet.has(item.id)),
    [newItems, selectedIdsSet],
  )

  const { markFor, toggle, handlePointerEnter, handlePointerLeaveList } = selection
  const isSelectable = useCallback(
    (itemId: string) => isRowSelectable(itemId, selectedIdsSet, false, limit),
    [selectedIdsSet, limit],
  )
  const rowSelection = useMemo<ReviewRowSelection>(
    () => ({
      markFor,
      isSelectable,
      onToggle: toggle,
      onPointerEnter: handlePointerEnter,
      onPointerLeaveList: handlePointerLeaveList,
    }),
    [markFor, isSelectable, toggle, handlePointerEnter, handlePointerLeaveList],
  )

  // The first page counts every new item in scope, loaded or not
  const newItemCount = isInScope ? (pages?.pages[0]?.counts.new ?? 0) : 0

  return {
    // The accounts the review block reads its items for. A bulk decision lowers their counts
    scope: accountIds,
    selectedItems,
    rowSelection,
    newItemCount,
    clear: selection.clear,
  }
}
