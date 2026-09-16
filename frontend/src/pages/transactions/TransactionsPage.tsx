import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { motion, useAnimationControls, useReducedMotion } from 'motion/react'
import { flushSync } from 'react-dom'
import { withMinDelay } from '@/utils/timing'
import { useNavigate } from 'react-router'
import { useAuth } from '@/hooks/useAuth'
import { useAccounts } from '@/api/accounts'
import {
  useLoadTransaction,
  useTransactionsOverview,
  type Transaction,
} from '@/api/transactions'
import TransactionListSection from '@/pages/transactions/components/ListSection'
import CreateTransactionModal from '@/pages/transactions/components/transaction-modal/Modal'
import { useCurrencyGuard } from '@/hooks/useCurrencyGuard'
import TransactionsTopBand from '@/pages/transactions/components/TopBand'
import { toTransactionListAccount } from '@/pages/transactions/types/transactionList'
import type { TransactionListFilters } from '@/pages/transactions/types/transactionList'
import {
  formatOverviewRangeLabel,
  getCurrentMonthOverviewRange,
} from '@/pages/transactions/utils/date'

// Matches the overview loading minimum while keeping feedback inside the retry button
const RETRY_MIN_MS = 800

// Fade out the failed summary before revealing the recovered summary without chart entrances
const RETRY_FADE_SECONDS = 0.2

/**
 * Renders the transactions page overview, filters, list, and transaction modal workflows
 */
export default function TransactionsPage() {
  const navigate = useNavigate()
  const prefersReducedMotion = useReducedMotion()
  const loadTransaction = useLoadTransaction()
  const { user } = useAuth()
  const { data: accounts } = useAccounts()
  const displayCurrency = user!.base_currency
  const latestTransactionsRef = useRef<Transaction[]>([])
  const [filters, setFilters] = useState<TransactionListFilters>({})
  const [filterListLoading, setFilterListLoading] = useState(false)
  const [showCreateModal, setShowCreateModal] = useState(false)
  const requireCurrencies = useCurrencyGuard()
  const [createModalKey, setCreateModalKey] = useState(0)
  const [editingTransaction, setEditingTransaction] = useState<Transaction | null>(null)
  const [openingOutlierId, setOpeningOutlierId] = useState<string | null>(null)
  const [outlierLoadError, setOutlierLoadError] = useState<string | null>(null)

  /**
   * Opens the transaction modal in create mode and resets any previous edit state
   */
  const openCreateModal = () => {
    requireCurrencies(() => {
      setEditingTransaction(null)
      setCreateModalKey((key) => key + 1)
      setShowCreateModal(true)
    })
  }

  /**
   * Opens the import page, which asks which account each row belongs to
   *
   * This list spans every account, so the import is not fixed to one the way it is from an account's
   * own page, and the address carries none
   */
  const openImport = () => {
    navigate('/settings/imports')
  }

  /**
   * Opens the transaction modal in edit mode, including read-only archived account transactions
   */
  const openEditModal = (transaction: Transaction) => {
    setEditingTransaction(transaction)
    setCreateModalKey((key) => key + 1)
    setShowCreateModal(true)
  }

  /**
   * Opens a top-band outlier transaction from the loaded list or a cached detail fetch
   */
  const openOutlierTransaction = async (transactionId: string) => {
    setOutlierLoadError(null)

    // Outliers may not be in the currently loaded list page, so fall back to a detail fetch
    const loadedTransaction = latestTransactionsRef.current.find((transaction) => transaction.id === transactionId)
    if (loadedTransaction) {
      openEditModal(loadedTransaction)
      return
    }

    setOpeningOutlierId(transactionId)
    try {
      const transaction = await loadTransaction(transactionId)
      openEditModal(transaction)
    } catch {
      setOutlierLoadError('Unable to open transaction')
    } finally {
      setOpeningOutlierId((current) => (current === transactionId ? null : current))
    }
  }

  const { monthStart, today } = useMemo(
    () => getCurrentMonthOverviewRange(user!.tz),
    [user],
  )

  const overviewFromDate = filters.from_date ?? monthStart
  const overviewToDate = filters.to_date ?? today
  const rangeLabel = useMemo(
    () => formatOverviewRangeLabel(overviewFromDate, overviewToDate),
    [overviewFromDate, overviewToDate],
  )
  // The overview supports a single account and the date range, so it scopes to the chosen account
  // only when exactly one is selected and otherwise spans every account
  const overviewAccountId = filters.account_id?.length === 1 ? filters.account_id[0] : undefined
  const {
    data: overview,
    isFetching: isOverviewFetching,
    isError: isOverviewError,
    refetch: refetchOverview,
  } = useTransactionsOverview({
    account_id: overviewAccountId,
    from_date: overviewFromDate,
    to_date: overviewToDate,
  })

  // Chart remounts preserve the pre-refactor animation timing when filters change
  const chartAnimationKey = [
    filters.account_id?.join(',') || 'all-accounts',
    filters.category_id?.join(',') || 'all-categories',
    overviewFromDate,
    overviewToDate,
  ].join('|')
  const summaryAnimation = useAnimationControls()
  const [retryKey, setRetryKey] = useState<string | null>(null)
  const [recoveredKey, setRecoveredKey] = useState<string | null>(null)
  const activeRetryRef = useRef<object | null>(null)
  const currentOverviewKeyRef = useRef(chartAnimationKey)
  const [renderedOverviewKey, setRenderedOverviewKey] = useState(chartAnimationKey)
  if (renderedOverviewKey !== chartAnimationKey) {
    setRenderedOverviewKey(chartAnimationKey)
    setRetryKey(null)
    setRecoveredKey(null)
  }
  const retrying = retryKey === chartAnimationKey

  // A filter change or unmount invalidates the previous retry's visual transition
  useEffect(() => {
    currentOverviewKeyRef.current = chartAnimationKey
    activeRetryRef.current = null
    summaryAnimation.stop()
    summaryAnimation.set({ opacity: 1 })
    return () => {
      activeRetryRef.current = null
      summaryAnimation.stop()
    }
  }, [chartAnimationKey, summaryAnimation])

  /** Retries only the current summary, then swaps its failure view while the summary is faded out */
  const handleRetryOverview = async () => {
    if (activeRetryRef.current || isOverviewFetching) return
    const request = {}
    activeRetryRef.current = request
    setRetryKey(chartAnimationKey)
    setRecoveredKey(chartAnimationKey)
    const result = await withMinDelay(() => refetchOverview({ cancelRefetch: false }), RETRY_MIN_MS)
    if (activeRetryRef.current !== request || currentOverviewKeyRef.current !== chartAnimationKey) return
    if (!result.isError) {
      await summaryAnimation.start({ opacity: 0, transition: { duration: prefersReducedMotion ? 0 : RETRY_FADE_SECONDS } })
      if (activeRetryRef.current !== request) return
      flushSync(() => setRetryKey(null))
      await summaryAnimation.start({ opacity: 1, transition: { duration: prefersReducedMotion ? 0 : RETRY_FADE_SECONDS } })
    } else {
      setRetryKey(null)
    }
    if (activeRetryRef.current === request) activeRetryRef.current = null
  }

  const transactionAccounts = useMemo(
    () => (accounts ?? []).map(toTransactionListAccount),
    [accounts],
  )
  const editingTransactionReadOnly = useMemo(() => {
    if (!editingTransaction) return false

    return Boolean(accounts?.find((account) => account.id === editingTransaction.account_id)?.is_archived)
  }, [accounts, editingTransaction])
  const handleSettledTransactionsChange = useCallback((transactions: Transaction[]) => {
    latestTransactionsRef.current = transactions
  }, [])

  return (
    <div>
      <header className="app-page-header space-y-1.5">
        <h1 className="app-page-title">Transactions</h1>
        <p className="app-page-description">Every transaction, all in one place.</p>
      </header>

      <div>
        <div className="space-y-3">
          <motion.div animate={summaryAnimation} initial={false}>
            <TransactionsTopBand
              overview={overview}
              displayCurrency={displayCurrency}
              loading={filterListLoading || isOverviewFetching}
              failed={isOverviewError}
              retrying={retrying}
              skipEntrance={recoveredKey === chartAnimationKey}
              rangeLabel={rangeLabel}
              fromDate={overviewFromDate}
              toDate={overviewToDate}
              chartAnimationKey={chartAnimationKey}
              prefersReducedMotion={prefersReducedMotion}
              openingOutlierId={openingOutlierId}
              outlierLoadError={outlierLoadError}
              onRetry={() => { void handleRetryOverview() }}
              onOpenOutlierTransaction={(transactionId) => { void openOutlierTransaction(transactionId) }}
            />
          </motion.div>

          <div
            style={{
              height: 2,
              background: 'var(--app-border-strong)',
              borderRadius: 1,
            }}
          />
        </div>

        <TransactionListSection
          accounts={transactionAccounts}
          currency={displayCurrency}
          filters={filters}
          onFiltersChange={setFilters}
          onFilterLoadingChange={setFilterListLoading}
          onSettledTransactionsChange={handleSettledTransactionsChange}
          onCreateTransaction={openCreateModal}
          onEditTransaction={openEditModal}
          onImport={openImport}
        />
      </div>

      <CreateTransactionModal
        key={createModalKey}
        open={showCreateModal}
        onClose={() => setShowCreateModal(false)}
        transaction={editingTransaction ?? undefined}
        readOnly={editingTransactionReadOnly}
      />
    </div>
  )
}
