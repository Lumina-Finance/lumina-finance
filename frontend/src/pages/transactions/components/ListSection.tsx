import { useCallback, useEffect, useMemo, useState } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { useCategories } from '@/api/categories'
import { ApiError } from '@/api/auth'
import {
  useBulkUpdateTransactions,
  useInfiniteTransactions,
  type Transaction,
} from '@/api/transactions'
import { useToast } from '@/hooks/useToast'
import { BulkEditModal } from '@/pages/transactions/components/bulk-edit/BulkEditModal'
import { BulkEditConfirm } from '@/pages/transactions/components/bulk-edit/BulkEditConfirm'
import {
  doesChosenCategoryRecordTransferTarget,
  isRowSelectable,
  type BulkEditFields,
  type SelectedTransactionFacts,
} from '@/pages/transactions/components/bulk-edit/selection'
import { useBulkSelection } from '@/pages/transactions/components/bulk-edit/useBulkSelection'
import { getTransactionReadOnlyReason } from '@/pages/transactions/utils/rowEditability'
import { getImportBlockReason, isImportableAccount } from '@/pages/imports/utils'
import { TRANSACTION_FILTER_KEYS, TRANSACTION_LIST_EASE } from '@/pages/transactions/constants/transactionList'
import TransactionDateGroupList from '@/pages/transactions/components/DateGroupList'
import TransactionFilterLoadingOverlay from '@/pages/transactions/components/FilterLoadingOverlay'
import TransactionListToolbar from '@/pages/transactions/components/toolbar/ListToolbar'
import { useTransactionFilterLoadingState } from '@/pages/transactions/hooks/useTransactionFilterLoadingState'
import { useInfiniteScrollTrigger } from '@/pages/transactions/hooks/useInfiniteScrollTrigger'
import { useTransactionSearch } from '@/pages/transactions/hooks/useTransactionSearch'
import type { TransactionListAccount, TransactionListFilters } from '@/pages/transactions/types/transactionList'
import { groupTransactionsByDate } from '@/pages/transactions/utils/transactionDateGroups'
import { normalizeTransactionFilters } from '@/pages/transactions/utils/normalizeTransactionFilters'

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
  onEditTransaction,
  onImport,
}: {
  fixedAccount?: TransactionListAccount
  accounts?: TransactionListAccount[]
  currency: string
  filters?: TransactionListFilters
  onFiltersChange?: (filters: TransactionListFilters) => void
  onFilterLoadingChange?: (loading: boolean) => void
  onSettledTransactionsChange?: (transactions: Transaction[]) => void
  onCreateTransaction: () => void
  onEditTransaction: (transaction: Transaction) => void

  // Opens an import filed into the account this list is fixed to, offered only alongside one
  onImport?: () => void
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
  const categoryMap = useMemo(
    () => new Map(categories?.map((category) => [category.id, category]) ?? []),
    [categories],
  )
  const accountMap = useMemo(
    () => new Map(accounts.map((account) => [account.id, account])),
    [accounts],
  )
  const dateGroups = useMemo(
    () => groupTransactionsByDate(displayedTransactions),
    [displayedTransactions],
  )
  const createDisabled = Boolean(fixedAccount?.is_archived)
  const createDisabledReason = createDisabled ? 'Archived accounts are read-only' : undefined

  const [isSelecting, setIsSelecting] = useState(false)
  const [pendingChange, setPendingChange] = useState<BulkEditFields | null>(null)

  // The ids the change was validated against at Apply, frozen alongside pendingChange rather than
  // read fresh off the live selection at Confirm, since the two have to agree on the same rows the
  // panel's blockers were computed for
  const [pendingChangeIds, setPendingChangeIds] = useState<string[]>([])
  const [applyError, setApplyError] = useState<string | null>(null)
  const { showToast } = useToast()
  const bulkUpdate = useBulkUpdateTransactions()

  // The rows a range runs along, in the order they appear, carrying the same editable rule the row
  // itself shows
  const selectableRows = useMemo(
    () => displayedTransactions.map((transaction) => ({
      id: transaction.id,
      isReadOnly: Boolean(getTransactionReadOnlyReason(transaction, accountMap, categoryMap, fixedAccount)),
    })),
    [displayedTransactions, accountMap, categoryMap, fixedAccount],
  )

  const transactionCurrencyById = useMemo(
    () => new Map(displayedTransactions.map((transaction) => [transaction.id, transaction.currency])),
    [displayedTransactions],
  )

  // The search text is not part of the filters, so both go into the key that empties a selection
  const requestKey = useMemo(
    () => `${JSON.stringify(filters)}|${activeSearch}`,
    [filters, activeSearch],
  )

  const selection = useBulkSelection(selectableRows, requestKey, !filterListLoading)
  const { clear: clearSelection } = selection

  // A Set rather than the array useBulkSelection returns, since isRowSelectable does a membership
  // check per row and a fresh array scan for each one would be quadratic in the list's length
  const selectedIdsSet = useMemo(() => new Set(selection.selectedIds), [selection.selectedIds])

  const buildRowSelection = useCallback(
    (transactionId: string, isReadOnly: boolean) => ({
      mark: selection.markFor(transactionId),
      isSelectable: isRowSelectable(transactionId, selectedIdsSet, isReadOnly),
      onToggle: (withShift: boolean) => selection.toggle(transactionId, withShift),
      onPointerEnter: () => selection.handlePointerEnter(transactionId),
    }),
    [selection, selectedIdsSet],
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
    () => (fixedAccount && !accounts.some((account) => account.id === fixedAccount.id)
      ? [fixedAccount, ...accounts]
      : accounts),
    [fixedAccount, accounts],
  )

  // Losing the last ticked row ends the edit, which a refetch that no longer carries those rows can do
  // while it is open. It goes rather than animating out, since what it would animate out is a panel
  // relabelling itself to nothing on the way. Closed here rather than derived from the count, since a
  // count the user then puts back would reopen a dialog they never asked for a second time
  if (isEditMounted && selection.selectedIds.length === 0) {
    setIsEditOpen(false)
    setIsEditMounted(false)

    // A write already sent keeps its confirmation, which is where its refusal has to land
    if (!bulkUpdate.isPending) {
      setPendingChange(null)
      setPendingChangeIds([])
      setApplyError(null)
    }
  }

  // A refetch that changes which rows are selected, such as one dropping the only transfer among
  // them, can land while the confirmation is open and holding ids the panel's blockers were
  // validated against. Read by identity rather than by content, the same way the selection's own
  // array is a new one on every dispatch that changes it, so this only fires on an actual change.
  // The edit modal stays open underneath and picks up the new rows in its own preview, since only
  // the confirmation, not the edit itself, was tied to the ids that just moved
  const [lastCheckedSelectedIds, setLastCheckedSelectedIds] = useState(selection.selectedIds)
  if (selection.selectedIds !== lastCheckedSelectedIds) {
    setLastCheckedSelectedIds(selection.selectedIds)

    // A write already sent keeps its confirmation, which is where its result has to land, whatever
    // shrank the list while it was in flight
    if (pendingChange !== null && !bulkUpdate.isPending) {
      setPendingChange(null)
      setPendingChangeIds([])
      setApplyError(null)
    }
  }

  /**
   * Leaves selection mode, dropping the ticks, the anchor and any preview with them
   */
  const stopSelecting = useCallback(() => {
    setIsSelecting(false)
    setPendingChange(null)
    setPendingChangeIds([])
    setApplyError(null)
    clearSelection()
  }, [clearSelection])

  /**
   * Freezes the modal's change together with the ids it was validated against, so a selection that
   * moves before Confirm cannot pair a stale change with a different set of rows
   */
  function applyBulkEdit(fields: BulkEditFields) {
    setPendingChangeIds(selection.selectedIds)
    setPendingChange(fields)
  }

  /**
   * Writes the change the modal holds, keeping the confirmation open when the server refuses it
   */
  function applyPendingChange() {
    if (!pendingChange) return
    setApplyError(null)
    bulkUpdate.mutate(
      { transaction_ids: pendingChangeIds, ...pendingChange },
      {
        onSuccess: (result) => {
          setPendingChange(null)

          // Ends selection mode rather than only dropping the ticks, which would leave every checkbox
          // on screen with nothing in them and read as though nothing had happened
          stopSelecting()
          showToast({
            status: 'success',
            text: `${result.transactions_updated} ${result.transactions_updated === 1 ? 'transaction' : 'transactions'} updated.`,
          })
        },
        onError: (error) => {
          setApplyError(error instanceof ApiError ? error.message : 'Something went wrong. Please try again.')
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

  const { sentinelRef, showPendingFetch } = useInfiniteScrollTrigger({
    hasNextPage,
    isFetchingNextPage,
    disabled: filterListLoading,
    fetchNextPage: () => { void fetchNextPage() },
  })

  // A finished page load appends a whole batch of older rows at once, which looks chaotic if each grows
  // in. Arming this the moment a page fetch starts means it is still set when that page's rows mount, so
  // they appear without animating. Arming happens during render so it is in place before the rows commit
  const [skipAppendedEnter, setSkipAppendedEnter] = useState(false)
  const [wasFetchingNextPage, setWasFetchingNextPage] = useState(isFetchingNextPage)
  if (wasFetchingNextPage !== isFetchingNextPage) {
    setWasFetchingNextPage(isFetchingNextPage)
    if (isFetchingNextPage) setSkipAppendedEnter(true)
  }

  // Disarm once the fetch has resolved and its rows have mounted, so a later single create still animates
  useEffect(() => {
    if (isFetchingNextPage || !skipAppendedEnter) return
    const timer = window.setTimeout(() => setSkipAppendedEnter(false), 0)
    return () => window.clearTimeout(timer)
  }, [isFetchingNextPage, skipAppendedEnter])

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
        importDisabled={importDisabled}
        importDisabledReason={importDisabledReason}
        onStickyOffsetChange={setDateHeaderStickyTop}
        isSelecting={isSelecting}
        selectedCount={selection.selectedIds.length}
        editDisabledReason={categories ? undefined : 'Categories have not loaded yet'}
        onEditSelection={() => {
          setEditOpenings((count) => count + 1)
          setIsEditMounted(true)
          setIsEditOpen(true)
        }}
        onToggleSelecting={() => (isSelecting ? stopSelecting() : setIsSelecting(true))}
      />

      <div
        className="relative"
        aria-busy={filterListLoading}
        onMouseLeave={selection.handlePointerLeaveList}
      >
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
          ) : displayedTransactionsLoaded && dateGroups.length === 0 ? (
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
                onEditTransaction={onEditTransaction}
              />

              <div ref={sentinelRef} aria-hidden style={{ height: 1 }} />
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
            setPendingChange(null)
            setPendingChangeIds([])
            setApplyError(null)
          }}
          onExitComplete={() => {
            if (!isEditOpen) setIsEditMounted(false)
          }}
          rows={selectedFacts}
          selectedCurrencies={selectedCurrencies}
          accounts={accountsForBulkEdit}
          onApply={applyBulkEdit}
        />
      )}

      <BulkEditConfirm
        open={pendingChange !== null}
        count={pendingChangeIds.length}
        error={applyError}
        isApplying={bulkUpdate.isPending}
        onConfirm={applyPendingChange}
        onCancel={() => {
          setPendingChange(null)
          setPendingChangeIds([])
          setApplyError(null)
        }}
      />
    </section>
  )
}
