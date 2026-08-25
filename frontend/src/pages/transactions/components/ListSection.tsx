import { useCallback, useEffect, useMemo, useState } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { useCategories } from '@/api/categories'
import { ApiError } from '@/api/auth'
import {
  useBulkUpdateTransactions,
  useInfiniteTransactions,
  type BulkUpdateTransactionsPayload,
  type Transaction,
} from '@/api/transactions'
import { useToast } from '@/hooks/useToast'
import { BulkEditBar } from '@/pages/transactions/components/bulk-edit/BulkEditBar'
import { BulkEditConfirm } from '@/pages/transactions/components/bulk-edit/BulkEditConfirm'
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

/** What the bar sets, which is everything in a bulk request except the transactions it covers */
type BulkEditFields = Omit<BulkUpdateTransactionsPayload, 'transaction_ids'>

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
  const [applyError, setApplyError] = useState<string | null>(null)
  const { showToast } = useToast()
  const bulkUpdate = useBulkUpdateTransactions()

  // The rows a range runs along, in the order they appear, carrying the same editable rule the row
  // itself shows
  const selectableRows = useMemo(
    () => displayedTransactions.map((transaction) => ({
      id: transaction.id,
      isReadOnly: Boolean(getTransactionReadOnlyReason(transaction, accountMap, fixedAccount)),
    })),
    [displayedTransactions, accountMap, fixedAccount],
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

  const buildRowSelection = useCallback(
    (transactionId: string, isReadOnly: boolean) => ({
      mark: selection.markFor(transactionId),
      isSelectable: !isReadOnly,
      onToggle: (withShift: boolean) => selection.toggle(transactionId, withShift),
      onPointerEnter: () => selection.handlePointerEnter(transactionId),
    }),
    [selection],
  )

  /**
   * Leaves selection mode, dropping the ticks and the anchor with it
   */
  const stopSelecting = useCallback(() => {
    setIsSelecting(false)
    setPendingChange(null)
    setApplyError(null)
    clearSelection()
  }, [clearSelection])

  /**
   * Writes the change the bar holds, keeping the confirmation open when the server refuses it
   */
  function applyPendingChange() {
    if (!pendingChange) return
    setApplyError(null)
    bulkUpdate.mutate(
      { transaction_ids: selection.selectedIds, ...pendingChange },
      {
        onSuccess: (result) => {
          setPendingChange(null)
          clearSelection()
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

      {isSelecting && selection.selectedIds.length > 0 && (
        <BulkEditBar
          selectedIds={selection.selectedIds}
          selectedCurrencies={[
            ...new Set(
              selection.selectedIds
                .map((id) => transactionCurrencyById.get(id))
                .filter((currency): currency is string => Boolean(currency)),
            ),
          ]}
          accounts={
            fixedAccount && !accounts.some((account) => account.id === fixedAccount.id)
              ? [fixedAccount, ...accounts]
              : accounts
          }
          onApply={setPendingChange}
          onCancel={stopSelecting}
        />
      )}

      <BulkEditConfirm
        open={pendingChange !== null}
        count={selection.selectedIds.length}
        error={applyError}
        isApplying={bulkUpdate.isPending}
        onConfirm={applyPendingChange}
        onCancel={() => {
          setPendingChange(null)
          setApplyError(null)
        }}
      />
    </section>
  )
}
