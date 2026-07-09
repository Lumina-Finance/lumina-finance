import { useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { useCategories } from '@/api/categories'
import {
  useInfiniteTransactions,
  type Transaction,
} from '@/api/transactions'
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
}) {
  const prefersReducedMotion = useReducedMotion()
  const { search, setSearch, activeSearch, submitSearch } = useTransactionSearch()
  const [internalFilters, setInternalFilters] = useState<TransactionListFilters>(
    fixedAccount ? { account_id: [fixedAccount.id] } : {},
  )
  const filters = controlledFilters ?? internalFilters
  const filtersRef = useRef(filters)
  const [dateHeaderStickyTop, setDateHeaderStickyTop] = useState(DEFAULT_DATE_HEADER_STICKY_TOP)

  // `setFilter` reads from a ref so toolbar callbacks can stay stable while filters change
  useEffect(() => {
    filtersRef.current = filters
  }, [filters])

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
    const current = filtersRef.current
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

  const { sentinelRef, showPendingFetch } = useInfiniteScrollTrigger({
    hasNextPage,
    isFetchingNextPage,
    disabled: filterListLoading,
    fetchNextPage: () => { void fetchNextPage() },
  })

  // A finished page load appends a whole batch of older rows at once, which looks chaotic if each grows
  // in. The ref reads its previous committed value, so this is true only in the render the fetch flips
  // off, which is the render those appended rows first mount in, letting them appear without animating
  const wasFetchingNextPageRef = useRef(isFetchingNextPage)
  const justFinishedNextPage = wasFetchingNextPageRef.current && !isFetchingNextPage
  useEffect(() => {
    wasFetchingNextPageRef.current = isFetchingNextPage
  }, [isFetchingNextPage])

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
        onStickyOffsetChange={setDateHeaderStickyTop}
      />

      <div className="relative" aria-busy={filterListLoading}>
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
                skipEnterAnimation={justFinishedNextPage}
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
    </section>
  )
}
