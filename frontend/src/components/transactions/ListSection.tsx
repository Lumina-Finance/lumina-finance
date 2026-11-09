import { useCallback, useMemo, useState } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { useCategories } from '@/api/categories'
import { ApiError } from '@/api/auth'
import {
  useBankLinksByAccount,
  useBulkAddReviewItems,
  useBulkDismissReviewItems,
  type BankReviewItem,
} from '@/api/bank-sync'
import {
  useBulkDeleteTransactions,
  useBulkUpdateTransactions,
  useExportTransactions,
  useInfiniteTransactions,
  type Transaction,
} from '@/api/transactions'
import { useToast } from '@/hooks/useToast'
import { LOADING_ANIMATION_MIN_MS } from '@/utils/timing'
import { saveBlobAsFile } from '@/utils/downloadFile'
import { countNoun } from '@/utils/bankSync'
import { getSaveFailureMessage } from '@/utils/createFailure'
import {
  getExportBlockReason,
  getExportFailureMessage,
  getExportFilename,
  getExportScope,
} from '@/components/transactions/utils/exportFile'
import { ExportAllConfirm } from '@/components/transactions/export/ExportAllConfirm'
import { getActiveFilterCount } from '@/components/transactions/utils/filterOptions'
import { BulkEditModal } from '@/components/transactions/bulk-edit/BulkEditModal'
import { BulkDeleteConfirm } from '@/components/transactions/bulk-edit/BulkDeleteConfirm'
import { BulkEditConfirm } from '@/components/transactions/bulk-edit/BulkEditConfirm'
import { BulkDismissConfirm } from '@/components/transactions/bulk-edit/BulkDismissConfirm'
import { MAX_BULK_EDIT_TRANSACTIONS } from '@/components/transactions/bulk-edit/constants'
import {
  REVIEW_ITEMS_NOT_DELETED,
  REVIEW_ITEMS_NOT_EXPORTED,
  describeAddedButNotUpdated,
  describeBulkAdd,
  describeBulkDismiss,
  describeTickLimit,
  getDismissBlockReason,
  toBulkAddValues,
} from '@/components/transactions/bulk-edit/reviewSelection'
import { useReviewSelection } from '@/components/transactions/bank-review/useReviewSelection'
import { selectedTransactionsSignature } from '@/components/transactions/bulk-edit/confirmation'
import { getBulkDeleteBlockReason, getLinkedIdsOutside } from '@/components/transactions/bulk-edit/deletion'
import {
  doesChosenCategoryRecordTransferTarget,
  isRowSelectable,
  type BulkEditFields,
  type SelectedTransactionFacts,
} from '@/components/transactions/bulk-edit/selection'
import { useBulkSelection } from '@/components/transactions/bulk-edit/useBulkSelection'
import { getTransactionReadOnlyReason } from '@/components/transactions/utils/rowEditability'
import { getImportBlockReason, isImportableAccount } from '@/utils/importableAccount'
import { TRANSACTION_FILTER_KEYS, TRANSACTION_LIST_EASE } from '@/components/transactions/constants/transactionList'
import TransactionDateGroupList from '@/components/transactions/DateGroupList'
import { BankHoldsSection } from '@/components/transactions/bank-review/HoldsSection'
import { BankPendingSection } from '@/components/transactions/bank-review/PendingSection'
import { BankReviewSection, type ReviewFocusRequest } from '@/components/transactions/bank-review/ReviewSection'
import TransactionFilterLoadingOverlay from '@/components/transactions/FilterLoadingOverlay'
import TransactionListToolbar from '@/components/transactions/toolbar/ListToolbar'
import { useTransactionFilterLoadingState } from '@/components/transactions/hooks/useTransactionFilterLoadingState'
import { useInfiniteScrollTrigger } from '@/components/transactions/hooks/useInfiniteScrollTrigger'
import { useSkipAppendedEnter } from '@/components/transactions/hooks/useSkipAppendedEnter'
import { useTransactionSearch } from '@/components/transactions/hooks/useTransactionSearch'
import type { TransactionListAccount, TransactionListFilters } from '@/components/transactions/types/transactionList'
import { groupTransactionsByDate } from '@/components/transactions/utils/transactionDateGroups'
import { normalizeTransactionFilters } from '@/components/transactions/utils/normalizeTransactionFilters'
import { useTodayYmd } from '@/hooks/useTodayYmd'
import { splitUpcoming } from '@/utils/upcoming'

const DEFAULT_DATE_HEADER_STICKY_TOP = 72

/**
 * Compares two filter values, treating arrays as equal when they hold the same members so
 * re-selecting an identical set is not seen as a change
 */
function isSameFilterValue(a: unknown, b: unknown): boolean {
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false
    const members = new Set(b)
    return a.every((item) => members.has(item))
  }
  return a === b
}

/**
 * Wires transaction list filters, infinite loading, row grouping, and list rendering
 */
export default function TransactionListSection({
  fixedAccount,
  accounts = [],
  currency,
  filters: controlledFilters,
  onFiltersChange,
  onFilterLoadingChange,
  onSettledTransactionsChange,
  onCreateTransaction,
  createBlockReason,
  onEditTransaction,
  onImport,
  canExport,
}: {
  fixedAccount?: TransactionListAccount
  accounts?: TransactionListAccount[]
  currency: string
  filters?: TransactionListFilters
  onFiltersChange?: (filters: TransactionListFilters) => void
  onFilterLoadingChange?: (loading: boolean) => void
  onSettledTransactionsChange?: (transactions: Transaction[]) => void
  onCreateTransaction: () => void

  // Why Add transaction is off beyond the fixed account being archived, shown as its tooltip
  createBlockReason?: string
  onEditTransaction: (transaction: Transaction) => void

  // Opens an import filed into the account this list is fixed to, offered only alongside one
  onImport?: () => void

  // Offers the export on the list of every account. It saves what the list shows, so with no date
  // filter it covers every date, as the list does
  canExport?: boolean
}) {
  const prefersReducedMotion = useReducedMotion()
  const { search, setSearch, activeSearch, submitSearch } = useTransactionSearch()
  const [internalFilters, setInternalFilters] = useState<TransactionListFilters>(
    fixedAccount ? { account_id: [fixedAccount.id] } : {},
  )
  const filters = controlledFilters ?? internalFilters
  const [dateHeaderStickyTop, setDateHeaderStickyTop] = useState(DEFAULT_DATE_HEADER_STICKY_TOP)

  const {
    data: txnPages,
    error,
    hasNextPage,
    fetchNextPage,
    isFetchingNextPage,
    isFetching,
  } = useInfiniteTransactions({
    ...filters,
    q: activeSearch || undefined,
  })
  const transactions = useMemo(() => txnPages?.pages.flat() ?? [], [txnPages])
  const transactionsLoaded = txnPages !== undefined
  const {
    filterListLoading,
    displayedTransactions,
    displayedTransactionsLoaded,
    listRevealKey,
    beginFilterTransition,
  } = useTransactionFilterLoadingState({
    transactions,
    transactionsLoaded,
    isFetching,
    queryReady: txnPages !== undefined,
    error,
    onLoadingChange: onFilterLoadingChange,
    onSettledTransactionsChange,
  })

  /**
   * Applies list filters and tells the transition hook whether rows should hold or fade while the query updates
   */
  function setFilter(patch: Partial<TransactionListFilters>) {
    const current = filters
    const fixedAccountPatch = fixedAccount ? { account_id: [fixedAccount.id] } : {}
    const next = normalizeTransactionFilters({ ...current, ...patch, ...fixedAccountPatch })
    const changed = TRANSACTION_FILTER_KEYS.some((key) => !isSameFilterValue(current[key], next[key]))
    if (!changed) return

    // Account scoping is structural rather than a filter the user just applied, so it never holds the rows
    const isApplyingFilter = Object.entries(patch).some(([key, value]) => {
      if (key === 'account_id') return false
      return Array.isArray(value) ? value.length > 0 : Boolean(value)
    })
    beginFilterTransition(isApplyingFilter ? 'apply' : 'clear')

    if (onFiltersChange) {
      onFiltersChange(next)
    } else {
      setInternalFilters(next)
    }
  }

  const { data: categories } = useCategories()
  const categoryMap = useMemo(() => new Map(categories?.map((category) => [category.id, category]) ?? []), [categories])
  const accountMap = useMemo(() => new Map(accounts.map((account) => [account.id, account])), [accounts])
  const today = useTodayYmd()
  const [isUpcomingExpanded, setIsUpcomingExpanded] = useState(false)
  const { upcoming: upcomingTransactions, rest: pastTransactions } = useMemo(
    () => splitUpcoming(displayedTransactions, (transaction) => transaction.dt, today),
    [displayedTransactions, today],
  )
  // A section that empties closes, so it comes back collapsed as it first appeared
  if (upcomingTransactions.length === 0 && isUpcomingExpanded) setIsUpcomingExpanded(false)
  const upcomingDateGroups = useMemo(() => groupTransactionsByDate(upcomingTransactions), [upcomingTransactions])
  const dateGroups = useMemo(() => groupTransactionsByDate(pastTransactions), [pastTransactions])

  // The rows on screen, in the order they appear. Upcoming rows count only while their section is open,
  // so a range never runs through rows nobody can see and closing the section drops their ticks
  const shownTransactions = useMemo(
    () => (isUpcomingExpanded ? [...upcomingTransactions, ...pastTransactions] : pastTransactions),
    [isUpcomingExpanded, upcomingTransactions, pastTransactions],
  )
  const createDisabledReason = fixedAccount?.is_archived ? 'Archived accounts are read-only' : createBlockReason
  const createDisabled = Boolean(createDisabledReason)

  // A row's Needs review marker asks the review block to go to the row's waiting item
  const [reviewFocus, setReviewFocus] = useState<ReviewFocusRequest | null>(null)
  const showReviewItem = useCallback(
    (itemId: string) => setReviewFocus((current) => ({ itemId, nonce: (current?.nonce ?? 0) + 1 })),
    [],
  )

  // Held between renders, so the review block and the pending strip skip the list's own renders, such
  // as one per search keystroke
  const fixedAccountId = fixedAccount?.id
  const reviewAccountIds = useMemo(
    () => (fixedAccountId ? [fixedAccountId] : filters.account_id),
    [fixedAccountId, filters.account_id],
  )

  const [isSelecting, setIsSelecting] = useState(false)
  const [pendingChange, setPendingChange] = useState<BulkEditFields | null>(null)

  // The ids and stored values the change was validated against at Apply, frozen alongside
  // pendingChange so Confirm cannot apply an old preview to refreshed transaction data
  const [pendingChangeIds, setPendingChangeIds] = useState<string[]>([])
  const [pendingChangeSignature, setPendingChangeSignature] = useState<string | null>(null)
  const [applyError, setApplyError] = useState<string | null>(null)
  const { showToast } = useToast()
  const bulkUpdate = useBulkUpdateTransactions({ minimumPendingMs: LOADING_ANIMATION_MIN_MS })

  // The ids the delete confirmation was opened for, frozen so a refetch while it is open cannot change
  // what Delete removes. Null while it is closed
  const [pendingDeleteIds, setPendingDeleteIds] = useState<string[] | null>(null)
  const [deleteError, setDeleteError] = useState<string | null>(null)

  // The transactions outside the selection that are linked to it, frozen with the ids, and whether the
  // user chose to delete them too. Unchecked by default, so only the links go
  const [linkedIdsOutside, setLinkedIdsOutside] = useState<string[]>([])
  const [deleteLinked, setDeleteLinked] = useState(false)

  // Kept after the confirmation closes, so its title does not read 0 while it fades out
  const [deleteCount, setDeleteCount] = useState(0)
  const bulkDelete = useBulkDeleteTransactions({ minimumPendingMs: LOADING_ANIMATION_MIN_MS })

  // The rows a range runs along, in the order they appear, carrying the same editable rule the row
  // itself shows
  const selectableRows = useMemo(
    () =>
      shownTransactions.map((transaction) => ({
        id: transaction.id,
        isReadOnly: Boolean(getTransactionReadOnlyReason(transaction, accountMap, categoryMap, fixedAccount)),
      })),
    [shownTransactions, accountMap, categoryMap, fixedAccount],
  )

  const transactionCurrencyById = useMemo(
    () => new Map(displayedTransactions.map((transaction) => [transaction.id, transaction.currency])),
    [displayedTransactions],
  )

  // The search text is not part of the filters, so both go into the key that empties a selection
  const requestKey = useMemo(() => `${JSON.stringify(filters)}|${activeSearch}`, [filters, activeSearch])

  // One bulk edit covers ledger transactions and items waiting for review together, so each list may
  // tick what the other leaves of the limit. The review count is held in state, since its selection
  // reads the ledger's, and is brought up to date in the render that changes it
  const [reviewTickCount, setReviewTickCount] = useState(0)
  const ledgerLimit = MAX_BULK_EDIT_TRANSACTIONS - reviewTickCount
  const selection = useBulkSelection(selectableRows, requestKey, !filterListLoading, ledgerLimit)
  const { clear: clearSelection } = selection
  const reviewSelection = useReviewSelection(
    reviewAccountIds,
    MAX_BULK_EDIT_TRANSACTIONS - selection.selectedIds.length,
  )
  const { clear: clearReviewSelection, selectedItems: selectedReviewItems } = reviewSelection
  const reviewCount = selectedReviewItems.length
  if (reviewCount !== reviewTickCount) setReviewTickCount(reviewCount)
  const ledgerCount = selection.selectedIds.length
  const totalSelected = ledgerCount + reviewCount

  // Dismiss is offered only while a new item waits in the list's accounts, or one is still ticked
  const offersDismiss = reviewSelection.newItemCount > 0 || reviewCount > 0
  const limitReason = describeTickLimit(offersDismiss)

  // A Set rather than the array useBulkSelection returns, since isRowSelectable does a membership
  // check per row and a fresh array scan for each one would be quadratic in the list's length
  const selectedIdsSet = useMemo(() => new Set(selection.selectedIds), [selection.selectedIds])
  const selectedChangeSignature = useMemo(
    () => selectedTransactionsSignature(displayedTransactions, selection.selectedIds),
    [displayedTransactions, selection.selectedIds],
  )

  const buildRowSelection = useCallback(
    (transactionId: string, isReadOnly: boolean) => ({
      mark: selection.markFor(transactionId),
      isSelectable: isRowSelectable(transactionId, selectedIdsSet, isReadOnly, ledgerLimit),
      limitReason,
      onToggle: (withShift: boolean) => selection.toggle(transactionId, withShift),
      onPointerEnter: () => selection.handlePointerEnter(transactionId),
    }),
    [selection, selectedIdsSet, ledgerLimit, limitReason],
  )

  // Takes the transactions one day heading shows, which is what its tick covers. Whether any of them
  // can be edited is decided inside the selection, so nothing is filtered here
  const buildHeadingSelection = useCallback(
    (shownTransactionIds: string[]) => ({
      mark: selection.groupMarkFor(shownTransactionIds),

      // A touch tap or a keyboard activation leaves no pointer resting on the heading afterward to
      // clear the preview the way a mouse leaving the tick does, so the heading passes that along
      // from the click itself
      onToggle: (clearsHover: boolean) => selection.toggleGroup(shownTransactionIds, { clearsHover }),
      onPointerMove: () => selection.handleGroupPointerMove(shownTransactionIds),
      onPointerLeave: () => selection.handleGroupPointerLeave(),
    }),
    [selection],
  )

  const [isEditOpen, setIsEditOpen] = useState(false)

  // Kept mounted only while the edit is up or closing, so each opening starts on a fresh set of
  // controls. Left mounted throughout, it would come back holding what the last edit set, and applying
  // that to a different set of transactions is a change nobody asked for. It would also keep loading
  // merchants and tags on a page where nobody has asked to edit anything
  const [isEditMounted, setIsEditMounted] = useState(false)

  // Keys the modal, so a reopen inside the quarter second the last one takes to fade out still mounts a
  // fresh instance rather than reusing the one still on its way off screen
  const [editOpenings, setEditOpenings] = useState(0)

  // What the bulk edit rules read about each ticked row. Whether a transfer has an answer for its
  // other side is read off the scope rather than the account, the way the server reads it, so one
  // recorded as going outside the tracked accounts counts as answered
  const selectedFacts = useMemo<SelectedTransactionFacts[]>(() => {
    const selected = new Set(selection.selectedIds)
    return displayedTransactions
      .filter((transaction) => selected.has(transaction.id))
      .map((transaction) => ({
        id: transaction.id,
        accountId: transaction.account_id,
        hasMerchant: Boolean(transaction.merchant_id),
        recordsFarSide: doesChosenCategoryRecordTransferTarget(categoryMap.get(transaction.category_id)),
        hasFarSideRecorded: transaction.counterparty_account_scope !== null,
        farSideAccountId: transaction.counterparty_account_id,
        currency: transaction.currency,
        isZeroAmount: transaction.amount === 0,
        direction: transaction.amount < 0 ? 'debit' : 'credit',
      }))
  }, [displayedTransactions, selection.selectedIds, categoryMap])

  const selectedCurrencies = useMemo(
    () => [
      ...new Set(
        selection.selectedIds
          .map((id) => transactionCurrencyById.get(id))
          .filter((currency): currency is string => Boolean(currency)),
      ),
    ],
    [selection.selectedIds, transactionCurrencyById],
  )

  // A list fixed to one account is often showing an account the account list does not carry, and both
  // the move targets and the far account options have to be able to name it
  const accountsForBulkEdit = useMemo(
    () => (fixedAccount ? [fixedAccount, ...accounts.filter((account) => account.id !== fixedAccount.id)] : accounts),
    [fixedAccount, accounts],
  )

  const bulkAdd = useBulkAddReviewItems()
  const isWriting = bulkUpdate.isPending || bulkAdd.isPending

  // The items waiting for review the change adds, frozen with pendingChange
  const [pendingReviewItems, setPendingReviewItems] = useState<BankReviewItem[]>([])

  /**
   * Drops the change the confirmation holds, closing it
   */
  const dropPendingChange = useCallback(() => {
    setPendingChange(null)
    setPendingChangeIds([])
    setPendingReviewItems([])
    setPendingChangeSignature(null)
    setApplyError(null)
  }, [])

  // Losing the last ticked row ends the edit, which a refetch that no longer carries those rows can do
  // while it is open. It goes rather than animating out, since what it would animate out is a panel
  // relabelling itself to nothing on the way. Closed here rather than derived from the count, since a
  // count the user then puts back would reopen a dialogue they never asked for a second time
  if (isEditMounted && totalSelected === 0) {
    setIsEditOpen(false)
    setIsEditMounted(false)

    // A write already sent keeps its confirmation, which is where its refusal has to land
    if (!isWriting) dropPendingChange()
  }

  // Keep a sent request visible until it settles. If its confirmation then remains open after a
  // refusal, the refreshed values still invalidate it on that render
  if (
    pendingChange !== null &&
    pendingChangeSignature !== null &&
    pendingChangeSignature !== selectedChangeSignature &&
    !isWriting
  ) {
    dropPendingChange()
  }

  /**
   * Leaves selection mode, dropping the ticks, the anchor and any preview with them
   */
  const stopSelecting = useCallback(() => {
    setIsSelecting(false)
    dropPendingChange()
    clearSelection()
    clearReviewSelection()
  }, [clearSelection, clearReviewSelection, dropPendingChange])

  /**
   * Adds the ticked items waiting for review straight from the modal, when no ledger transaction is
   * ticked beside them. Adding them can be undone by deleting what was added, so it isn't confirmed
   */
  function addReviewItemsOnly(fields: BulkEditFields) {
    if (bulkAdd.isPending) return
    bulkAdd.mutate(
      { scope: reviewSelection.scope, items: selectedReviewItems, values: toBulkAddValues(fields) },
      {
        onSuccess: (result) => {
          stopSelecting()
          showToast({
            status: 'success',
            text: describeBulkAdd(result.decided_ids.length, result.skipped_ids.length, null),
          })
        },
        onError: (error) => {
          showToast({
            status: 'error',
            text: getSaveFailureMessage(error),
          })
        },
      },
    )
  }

  /**
   * Freezes the modal's change with the selected ids and their stored values at Apply. Items waiting
   * for review on their own are added at once, and anything that touches the ledger is confirmed
   */
  function applyBulkEdit(fields: BulkEditFields) {
    if (ledgerCount === 0) {
      addReviewItemsOnly(fields)
      return
    }
    setPendingChangeIds([...selection.selectedIds])
    setPendingReviewItems(selectedReviewItems)
    setPendingChangeSignature(selectedChangeSignature)
    setPendingChange(fields)
  }

  /**
   * Updates the ticked ledger transactions, saying in the toast how many items were added before
   * them, or null when none were
   */
  function updateLedgerTransactions(fields: BulkEditFields, added: { count: number; skipped: number } | null) {
    bulkUpdate.mutate(
      { transaction_ids: pendingChangeIds, ...fields },
      {
        onSuccess: (result) => {
          setPendingChange(null)

          // Ends selection mode rather than only dropping the ticks, which would leave every checkbox
          // on screen with nothing in them and read as though nothing had happened
          stopSelecting()
          const updated = result.transactions_updated
          showToast({
            status: 'success',
            text: added
              ? describeBulkAdd(added.count, added.skipped, updated)
              : `${countNoun(updated, 'transaction')} updated.`,
          })
        },
        onError: (error) => {
          const reason = getSaveFailureMessage(error)
          if (!added) {
            setApplyError(reason)
            return
          }

          // The items are in the ledger by now, so the confirmation can't offer the same change
          // again. The ledger ticks stay for another try
          dropPendingChange()
          setIsEditOpen(false)
          showToast({ status: 'error', text: describeAddedButNotUpdated(added.count, reason) })
        },
      },
    )
  }

  /**
   * Writes the change the modal holds, keeping a refusal open while the selected values still match.
   * Items waiting for review are added first, and the ledger transactions are updated once they are
   */
  function applyPendingChange() {
    if (!pendingChange) return
    if (pendingChangeSignature !== selectedChangeSignature) {
      dropPendingChange()
      return
    }
    setApplyError(null)
    if (pendingReviewItems.length === 0) {
      updateLedgerTransactions(pendingChange, null)
      return
    }
    const fields = pendingChange
    bulkAdd.mutate(
      { scope: reviewSelection.scope, items: pendingReviewItems, values: toBulkAddValues(fields) },
      {
        onSuccess: (result) =>
          updateLedgerTransactions(fields, { count: result.decided_ids.length, skipped: result.skipped_ids.length }),
        onError: (error) => {
          setApplyError(error instanceof ApiError ? error.message : 'Something went wrong. Please try again.')
        },
      },
    )
  }

  // The items the dismiss confirmation was opened for, frozen like the delete's ids. Null while it is
  // closed, with the count kept so its title doesn't read 0 while it fades out
  const [pendingDismissItems, setPendingDismissItems] = useState<BankReviewItem[] | null>(null)
  const [dismissCount, setDismissCount] = useState(0)
  const [dismissError, setDismissError] = useState<string | null>(null)
  const bulkDismiss = useBulkDismissReviewItems()

  /**
   * Dismisses the items the confirmation was opened for, keeping a refusal open with its reason
   */
  function dismissPendingItems() {
    if (!pendingDismissItems) return
    setDismissError(null)
    bulkDismiss.mutate(
      { scope: reviewSelection.scope, items: pendingDismissItems },
      {
        onSuccess: (result) => {
          setPendingDismissItems(null)
          stopSelecting()
          showToast({
            status: 'success',
            text: describeBulkDismiss(result.decided_ids.length, result.skipped_ids.length),
          })
        },
        onError: (error) => {
          setDismissError(getSaveFailureMessage(error))
        },
      },
    )
  }

  const linksByAccount = useBankLinksByAccount()
  const deleteDisabledReason = useMemo(() => {
    if (reviewCount > 0) return REVIEW_ITEMS_NOT_DELETED
    const selected = new Set(selection.selectedIds)
    return getBulkDeleteBlockReason(
      displayedTransactions.filter((transaction) => selected.has(transaction.id)),
      accountMap,
      fixedAccount,
      linksByAccount,
    )
  }, [reviewCount, displayedTransactions, selection.selectedIds, accountMap, fixedAccount, linksByAccount])

  /**
   * Deletes the transactions the confirmation was opened for, keeping a refusal open with its reason
   */
  function deletePendingSelection() {
    if (!pendingDeleteIds) return
    setDeleteError(null)
    const takeLinked = deleteLinked && linkedIdsOutside.length > 0
    bulkDelete.mutate(
      { transactionIds: pendingDeleteIds, linkedIds: takeLinked ? linkedIdsOutside : [] },
      {
        onSuccess: (result) => {
          setPendingDeleteIds(null)
          stopSelecting()
          showToast({
            status: 'success',
            text: `${result.transactions_deleted} ${result.transactions_deleted === 1 ? 'transaction' : 'transactions'} deleted.`,
          })
        },
        onError: (error) => {
          setDeleteError(error instanceof ApiError ? error.message : 'Something went wrong. Please try again.')
        },
      },
    )
  }

  // Only a list fixed to one account can be blocked, since only that one writes rows to an account
  // of its own. On the list of every account the button is the way to the import page and is always
  // offered. Where it is blocked it stays on the row, greyed out with the reason, rather than
  // coming and going
  const importDisabled = Boolean(fixedAccount) && !isImportableAccount(fixedAccount)
  const importDisabledReason = getImportBlockReason(fixedAccount)

  const exportTransactions = useExportTransactions({ minimumPendingMs: LOADING_ANIMATION_MIN_MS })
  const [isExportAllConfirmOpen, setIsExportAllConfirmOpen] = useState(false)
  const isNarrowed = getActiveFilterCount(filters, true) > 0 || activeSearch !== ''
  // Ticked items waiting for review make it an export of the selection. It saves only the ledger
  // transactions among it, since the items aren't in the ledger
  const exportScope = getExportScope({ selectedCount: totalSelected, isNarrowed })
  const exportDisabledReason =
    ledgerCount === 0 && reviewCount > 0
      ? REVIEW_ITEMS_NOT_EXPORTED
      : getExportBlockReason({
          isLoaded: displayedTransactionsLoaded,
          hasError: Boolean(error),
          rowCount: displayedTransactions.length,
          isNarrowed,
        })

  /**
   * Saves the ticked rows, or every transaction the search and filters keep, as one CSV file
   */
  function downloadCsv() {
    exportTransactions.mutate(
      exportScope === 'selected'
        ? { transactionIds: [...selection.selectedIds] }
        : { filters: { ...filters, q: activeSearch || undefined } },
      {
        onSuccess: (file) => saveBlobAsFile(file, getExportFilename(today)),
        onError: (exportError) => showToast({ status: 'error', text: getExportFailureMessage(exportError) }),
      },
    )
  }

  // The whole history is the one export that asks first, since nothing on the list says how much it
  // saves. The other two are named by their button and run straight away
  function exportCsv() {
    if (exportScope === 'all') setIsExportAllConfirmOpen(true)
    else downloadCsv()
  }

  const { sentinelRef, showPendingFetch } = useInfiniteScrollTrigger({
    hasNextPage,
    isFetchingNextPage,
    disabled: filterListLoading,
    fetchNextPage: () => {
      void fetchNextPage()
    },
  })

  // A page of older rows appears at once rather than each row growing in
  const skipAppendedEnter = useSkipAppendedEnter(isFetchingNextPage)

  return (
    <section>
      <TransactionListToolbar
        search={search}
        onSearchChange={setSearch}
        onSearchSubmit={submitSearch}
        filters={filters}
        setFilter={setFilter}
        categories={categories}
        accounts={accounts}
        showAccountFilter={!fixedAccount}
        lockedCurrency={fixedAccount?.currency}
        onCreateTransaction={onCreateTransaction}
        createDisabled={createDisabled}
        createDisabledReason={createDisabledReason}
        onImport={onImport}
        onExport={canExport ? exportCsv : undefined}
        exportScope={exportScope}
        exportPending={exportTransactions.isPending}
        exportDisabledReason={exportDisabledReason}
        importDisabled={importDisabled}
        importDisabledReason={importDisabledReason}
        onStickyOffsetChange={setDateHeaderStickyTop}
        isSelecting={isSelecting}
        selectedCount={totalSelected}
        editDisabledReason={categories ? undefined : 'Categories have not loaded yet'}
        onEditSelection={() => {
          setEditOpenings((count) => count + 1)
          setIsEditMounted(true)
          setIsEditOpen(true)
        }}
        deleteDisabledReason={deleteDisabledReason}
        onDeleteSelection={() => {
          setDeleteError(null)
          setDeleteLinked(false)
          setLinkedIdsOutside(
            getLinkedIdsOutside(
              displayedTransactions.filter((transaction) => selection.selectedIds.includes(transaction.id)),
            ),
          )
          setPendingDeleteIds([...selection.selectedIds])
          setDeleteCount(selection.selectedIds.length)
        }}
        onDismissSelection={
          offersDismiss
            ? () => {
                setDismissError(null)
                setPendingDismissItems(selectedReviewItems)
                setDismissCount(reviewCount)
              }
            : undefined
        }
        dismissDisabledReason={getDismissBlockReason(ledgerCount, reviewCount)}
        onToggleSelecting={() => (isSelecting ? stopSelecting() : setIsSelecting(true))}
      />

      <BankReviewSection
        listAccountIds={reviewAccountIds}
        isFixedAccount={Boolean(fixedAccount)}
        focusRequest={reviewFocus}
        selection={isSelecting ? reviewSelection.rowSelection : undefined}
        prefersReducedMotion={prefersReducedMotion}
      />

      <BankHoldsSection
        listAccountIds={reviewAccountIds}
        isFixedAccount={Boolean(fixedAccount)}
        prefersReducedMotion={prefersReducedMotion}
      />

      <BankPendingSection
        listAccountIds={reviewAccountIds}
        isFixedAccount={Boolean(fixedAccount)}
        prefersReducedMotion={prefersReducedMotion}
      />

      <div className="relative" aria-busy={filterListLoading} onMouseLeave={selection.handlePointerLeaveList}>
        <AnimatePresence>
          {filterListLoading && <TransactionFilterLoadingOverlay reducedMotion={prefersReducedMotion} />}
        </AnimatePresence>

        <AnimatePresence initial={false} mode="wait">
          {error ? (
            <motion.p
              key={`error-${listRevealKey}`}
              className="py-2 font-medium"
              style={{ color: 'var(--app-negative)' }}
              exit={{ opacity: 0 }}
              transition={{ duration: prefersReducedMotion ? 0 : 0.2 }}
            >
              Unable to load transactions.
            </motion.p>
          ) : displayedTransactionsLoaded && displayedTransactions.length === 0 ? (
            <motion.p
              key={`empty-${listRevealKey}`}
              className="py-8 text-center italic text-sm"
              style={{ color: 'var(--app-text-subtle)' }}
              initial={listRevealKey === 0 || prefersReducedMotion ? false : { opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: prefersReducedMotion ? 0 : 0.28, ease: TRANSACTION_LIST_EASE }}
            >
              {search ? 'No transactions match your search.' : 'No transactions yet.'}
            </motion.p>
          ) : displayedTransactionsLoaded ? (
            <motion.section
              key={`list-${listRevealKey}`}
              initial={prefersReducedMotion ? false : { opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: prefersReducedMotion ? 0 : 0.22, ease: TRANSACTION_LIST_EASE }}
            >
              <TransactionDateGroupList
                dateGroups={dateGroups}
                upcomingDateGroups={upcomingDateGroups}
                today={today}
                isUpcomingExpanded={isUpcomingExpanded}
                onToggleUpcoming={() => setIsUpcomingExpanded((current) => !current)}
                categoryMap={categoryMap}
                accountMap={accountMap}
                fixedAccount={fixedAccount}
                currency={currency}
                listRevealKey={listRevealKey}
                stickyTop={dateHeaderStickyTop}
                prefersReducedMotion={prefersReducedMotion}
                skipEnterAnimation={skipAppendedEnter}
                isSelecting={isSelecting}
                buildRowSelection={isSelecting ? buildRowSelection : undefined}
                buildHeadingSelection={isSelecting ? buildHeadingSelection : undefined}
                onShowReview={showReviewItem}
                onEditTransaction={onEditTransaction}
              />

              <div ref={sentinelRef} data-testid="transaction-list-end" aria-hidden style={{ height: 1 }} />
              {isFetchingNextPage || showPendingFetch ? (
                <p className="py-4 text-center text-sm" style={{ color: 'var(--app-text-subtle)' }}>
                  Loading more transactions...
                </p>
              ) : hasNextPage === false ? (
                <p className="py-4 text-center text-sm italic" style={{ color: 'var(--app-text-subtle)' }}>
                  You've reached the end.
                </p>
              ) : null}
            </motion.section>
          ) : null}
        </AnimatePresence>
      </div>

      {isEditMounted && (
        <BulkEditModal
          key={editOpenings}
          open={isEditOpen}
          onClose={() => {
            setIsEditOpen(false)
            dropPendingChange()
          }}
          onExitComplete={() => {
            if (!isEditOpen) setIsEditMounted(false)
          }}
          rows={selectedFacts}
          selectedCurrencies={selectedCurrencies}
          accounts={accountsForBulkEdit}
          reviewCount={reviewCount}
          onApply={applyBulkEdit}
        />
      )}

      {canExport && (
        <ExportAllConfirm
          open={isExportAllConfirmOpen}
          onCancel={() => setIsExportAllConfirmOpen(false)}
          onConfirm={() => {
            setIsExportAllConfirmOpen(false)
            downloadCsv()
          }}
        />
      )}

      <BulkEditConfirm
        open={pendingChange !== null}
        count={pendingChangeIds.length}
        reviewCount={pendingReviewItems.length}
        error={applyError}
        isApplying={isWriting}
        onConfirm={applyPendingChange}
        onCancel={dropPendingChange}
      />

      <BulkDismissConfirm
        open={pendingDismissItems !== null}
        count={dismissCount}
        error={dismissError}
        isDismissing={bulkDismiss.isPending}
        onConfirm={dismissPendingItems}
        onCancel={() => {
          setPendingDismissItems(null)
          setDismissError(null)
        }}
      />

      <BulkDeleteConfirm
        open={pendingDeleteIds !== null}
        count={deleteCount}
        linkedCount={linkedIdsOutside.length}
        deleteLinked={deleteLinked}
        onDeleteLinkedChange={setDeleteLinked}
        error={deleteError}
        isDeleting={bulkDelete.isPending}
        onConfirm={deletePendingSelection}
        onCancel={() => {
          setPendingDeleteIds(null)
          setDeleteError(null)
        }}
      />
    </section>
  )
}
