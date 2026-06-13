import { useCallback, useEffect, useRef, useState, type MutableRefObject } from 'react'
import type { Transaction } from '@/api/transactions'
import { FILTER_LIST_LOADING_MIN_MS } from '@/pages/transactions/constants/transactionList'

export type TransactionFilterTransition = 'apply' | 'clear'

type UseTransactionFilterLoadingStateOptions = {
  transactions: Transaction[]
  transactionsLoaded: boolean
  isFetching: boolean
  queryReady: boolean
  error: unknown
  onLoadingChange?: (loading: boolean) => void
  onSettledTransactionsChange?: (transactions: Transaction[]) => void
}

type TransactionFilterLoadingState = {
  filterListLoading: boolean
  displayedTransactions: Transaction[]
  displayedTransactionsLoaded: boolean
  listRevealKey: number
  beginFilterTransition: (transition: TransactionFilterTransition) => void
}

/**
 * Clears a scheduled filter-loading timeout and resets the ref that tracks it
 */
function clearFilterLoadingTimeout(timeoutRef: MutableRefObject<ReturnType<typeof setTimeout> | null>) {
  if (timeoutRef.current === null) return
  clearTimeout(timeoutRef.current)
  timeoutRef.current = null
}

/**
 * Owns transaction-list row snapshots while filter changes animate between old and new query results
 */
export function useTransactionFilterLoadingState({
  transactions,
  transactionsLoaded,
  isFetching,
  queryReady,
  error,
  onLoadingChange,
  onSettledTransactionsChange,
}: UseTransactionFilterLoadingStateOptions): TransactionFilterLoadingState {
  const latestTransactionsRef = useRef<Transaction[]>([])
  const filterLoadingStartedAtRef = useRef(0)
  const filterLoadingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [filterListLoading, setFilterListLoading] = useState(false)
  const [filterLoadingRows, setFilterLoadingRows] = useState<Transaction[] | null>(null)
  const [pendingClearReveal, setPendingClearReveal] = useState(false)
  const [clearExitRows, setClearExitRows] = useState<Transaction[] | null>(null)
  const [listRevealKey, setListRevealKey] = useState(0)

  /**
   * Synchronises local list loading state with the parent top-band overlay state
   */
  const setFilterLoading = useCallback((loading: boolean) => {
    setFilterListLoading(loading)
    onLoadingChange?.(loading)
  }, [onLoadingChange])

  /**
   * Captures the current rendered rows before a filter update changes the query key
   */
  const beginFilterTransition = useCallback((transition: TransactionFilterTransition) => {
    if (transition === 'apply') {
      setPendingClearReveal(false)
      setClearExitRows(null)
      clearFilterLoadingTimeout(filterLoadingTimeoutRef)
      filterLoadingStartedAtRef.current = Date.now()
      setFilterLoadingRows(latestTransactionsRef.current)
      setFilterLoading(true)
      return
    }

    clearFilterLoadingTimeout(filterLoadingTimeoutRef)
    filterLoadingStartedAtRef.current = 0
    setFilterLoading(false)
    setFilterLoadingRows(null)
    setClearExitRows(latestTransactionsRef.current)
    setPendingClearReveal(true)
  }, [setFilterLoading])

  useEffect(() => {
    return () => clearFilterLoadingTimeout(filterLoadingTimeoutRef)
  }, [])

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

  useEffect(() => {
    if (!pendingClearReveal || isFetching || !queryReady) return undefined
    const revealTimeout = window.setTimeout(() => {
      setListRevealKey((key) => key + 1)
      setClearExitRows(null)
      setPendingClearReveal(false)
    }, 0)
    return () => window.clearTimeout(revealTimeout)
  }, [isFetching, pendingClearReveal, queryReady])

  useEffect(() => {
    if (!filterListLoading) return undefined
    if (!isFetching && (queryReady || error)) {
      const elapsed = Date.now() - filterLoadingStartedAtRef.current
      const remaining = Math.max(FILTER_LIST_LOADING_MIN_MS - elapsed, 0)
      clearFilterLoadingTimeout(filterLoadingTimeoutRef)
      filterLoadingTimeoutRef.current = setTimeout(() => {
        setFilterLoading(false)
        setFilterLoadingRows(null)
        filterLoadingStartedAtRef.current = 0
        filterLoadingTimeoutRef.current = null
      }, remaining)
    }
    return undefined
  }, [error, filterListLoading, isFetching, queryReady, setFilterLoading])

  const displayedTransactions = filterListLoading && filterLoadingRows
    ? filterLoadingRows
    : clearExitRows ?? transactions
  const displayedTransactionsLoaded =
    transactionsLoaded || (filterListLoading && filterLoadingRows !== null) || clearExitRows !== null

  return {
    filterListLoading,
    displayedTransactions,
    displayedTransactionsLoaded,
    listRevealKey,
    beginFilterTransition,
  }
}
