import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { useCategories } from '@/api/categories'
import {
  useInfiniteTransactions,
  type Transaction,
} from '@/api/transactions'
import { FILTER_LIST_LOADING_MIN_MS, TRANSACTION_FILTER_KEYS, TRANSACTION_LIST_EASE } from '@/transactions/constants/transactionList'
import TransactionDateGroupList from '@/transactions/components/TransactionDateGroupList'
import TransactionFilterLoadingOverlay from '@/transactions/components/TransactionFilterLoadingOverlay'
import TransactionListToolbar from '@/transactions/components/TransactionListToolbar'
import { useDateRangeDraft } from '@/transactions/hooks/useDateRangeDraft'
import { useInfiniteScrollTrigger } from '@/transactions/hooks/useInfiniteScrollTrigger'
import { useTransactionSearch } from '@/transactions/hooks/useTransactionSearch'
import type { TransactionListAccount, TransactionListFilters } from '@/transactions/types/transactionList'
import { groupTransactionsByDate } from '@/transactions/utils/groupTransactionsByDate'
import { normalizeTransactionFilters } from '@/transactions/utils/normalizeTransactionFilters'

const DEFAULT_DATE_HEADER_STICKY_TOP = 72

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
  const latestTransactionsRef = useRef<Transaction[]>([])
  const filterLoadingStartedAtRef = useRef(0)
  const filterLoadingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [internalFilters, setInternalFilters] = useState<TransactionListFilters>(
    fixedAccount ? { account_id: fixedAccount.id } : {},
  )
  const filters = controlledFilters ?? internalFilters
  const filtersRef = useRef(filters)
  const [filterListLoading, setFilterListLoading] = useState(false)
  const [filterLoadingRows, setFilterLoadingRows] = useState<Transaction[] | null>(null)
  const [pendingClearReveal, setPendingClearReveal] = useState(false)
  const [clearExitRows, setClearExitRows] = useState<Transaction[] | null>(null)
  const [listRevealKey, setListRevealKey] = useState(0)
  const [dateHeaderStickyTop, setDateHeaderStickyTop] = useState(DEFAULT_DATE_HEADER_STICKY_TOP)

  // `setFilter` reads the latest filters from a ref so child callbacks do not
  // need to be recreated for every filter change.
  useEffect(() => {
    filtersRef.current = filters
  }, [filters])

  const setFilterLoading = useCallback((loading: boolean) => {
    setFilterListLoading(loading)
    onFilterLoadingChange?.(loading)
  }, [onFilterLoadingChange])

  const setFilter = (patch: Partial<TransactionListFilters>) => {
    const current = filtersRef.current
    const fixedAccountPatch = fixedAccount ? { account_id: fixedAccount.id } : {}
    const next = normalizeTransactionFilters({ ...current, ...patch, ...fixedAccountPatch })
    const changed = TRANSACTION_FILTER_KEYS.some((key) => current[key] !== next[key])
    if (!changed) return

    const isApplyingFilter = Object.entries(patch).some(([key, value]) => (
      key !== 'account_id' && Boolean(value)
    ))
    if (isApplyingFilter) {
      setPendingClearReveal(false)
      setClearExitRows(null)
      if (filterLoadingTimeoutRef.current !== null) {
        clearTimeout(filterLoadingTimeoutRef.current)
        filterLoadingTimeoutRef.current = null
      }
      filterLoadingStartedAtRef.current = Date.now()
      setFilterLoadingRows(latestTransactionsRef.current)
      setFilterLoading(true)
    } else {
      if (filterLoadingTimeoutRef.current !== null) {
        clearTimeout(filterLoadingTimeoutRef.current)
        filterLoadingTimeoutRef.current = null
      }
      filterLoadingStartedAtRef.current = 0
      setFilterLoading(false)
      setFilterLoadingRows(null)
      setClearExitRows(latestTransactionsRef.current)
      setPendingClearReveal(true)
    }

    if (onFiltersChange) {
      onFiltersChange(next)
    } else {
      setInternalFilters(next)
    }
  }

  const {
    pendingFrom,
    pendingTo,
    setPendingFrom,
    setPendingTo,
    dateRangeInvalid,
    dateRangeChanged,
    commitDateRange,
  } = useDateRangeDraft({ filters, setFilter })

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
  const displayedTransactions = filterListLoading && filterLoadingRows
    ? filterLoadingRows
    : clearExitRows ?? transactions
  const displayedTransactionsLoaded =
    transactionsLoaded || (filterListLoading && filterLoadingRows !== null) || clearExitRows !== null

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

  // Filter changes can schedule delayed loading cleanup; clear that timer if
  // the list unmounts mid-transition.
  useEffect(() => {
    return () => {
      if (filterLoadingTimeoutRef.current !== null) {
        clearTimeout(filterLoadingTimeoutRef.current)
      }
    }
  }, [])

  // Remember the last settled rows so applying a filter can keep the old list
  // visible behind the loading overlay until the new query resolves.
  useEffect(() => {
    if (!filterListLoading && !pendingClearReveal && clearExitRows === null && transactionsLoaded) {
      latestTransactionsRef.current = transactions
      onSettledTransactionsChange?.(transactions)
    }
  }, [
    clearExitRows,
    filterListLoading,
    onSettledTransactionsChange,
    pendingClearReveal,
    transactions,
    transactionsLoaded,
  ])

  // Clearing filters fades out the old rows first, then reveals the refetched
  // unfiltered list on the next tick.
  useEffect(() => {
    if (!pendingClearReveal || isFetching || txnPages === undefined) return
    const revealTimeout = window.setTimeout(() => {
      setListRevealKey((key) => key + 1)
      setClearExitRows(null)
      setPendingClearReveal(false)
    }, 0)
    return () => window.clearTimeout(revealTimeout)
  }, [isFetching, pendingClearReveal, txnPages])

  // Keep the filter-loading overlay visible for a minimum duration so filter
  // transitions read as intentional instead of flashing.
  useEffect(() => {
    if (!filterListLoading) return
    if (!isFetching && (txnPages !== undefined || error)) {
      const elapsed = Date.now() - filterLoadingStartedAtRef.current
      const remaining = Math.max(FILTER_LIST_LOADING_MIN_MS - elapsed, 0)
      if (filterLoadingTimeoutRef.current !== null) {
        clearTimeout(filterLoadingTimeoutRef.current)
      }
      filterLoadingTimeoutRef.current = setTimeout(() => {
        setFilterLoading(false)
        setFilterLoadingRows(null)
        filterLoadingStartedAtRef.current = 0
        filterLoadingTimeoutRef.current = null
      }, remaining)
    }
  }, [error, filterListLoading, isFetching, setFilterLoading, txnPages])

  const { sentinelRef, showPendingFetch } = useInfiniteScrollTrigger({
    hasNextPage,
    isFetchingNextPage,
    disabled: filterListLoading,
    fetchNextPage: () => { void fetchNextPage() },
  })

  return (
    <section className="transaction-list-section">
      <TransactionListToolbar
        search={search}
        onSearchChange={setSearch}
        onSearchSubmit={submitSearch}
        filters={filters}
        setFilter={setFilter}
        categories={categories}
        accounts={accounts}
        showAccountFilter={!fixedAccount}
        pendingFrom={pendingFrom}
        pendingTo={pendingTo}
        dateRangeChanged={dateRangeChanged}
        dateRangeInvalid={dateRangeInvalid}
        onPendingFromChange={setPendingFrom}
        onPendingToChange={setPendingTo}
        onDateRangeReset={() => {
          setPendingFrom('')
          setPendingTo('')
        }}
        onDateRangeClose={commitDateRange}
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
              className="space-y-4"
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
                onEditTransaction={onEditTransaction}
              />

              <div ref={sentinelRef} aria-hidden style={{ height: 1 }} />
              {isFetchingNextPage || showPendingFetch ? (
                <p className="py-4 text-center text-sm" style={{ color: 'var(--app-text-subtle)' }}>
                  Loading more transactions...
                </p>
              ) : hasNextPage === false ? (
                <p
                  className="py-4 text-center text-sm italic"
                  style={{ color: 'var(--app-text-subtle)' }}
                >
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
