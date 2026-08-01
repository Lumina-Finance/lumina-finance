import { useCallback, useMemo, useRef, useState } from 'react'
import { useReducedMotion } from 'motion/react'
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

/**
 * Renders the transactions page overview, filters, list, and transaction modal workflows
 */
export default function TransactionsPage() {
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
  const { data: overview, isFetching: isOverviewFetching } = useTransactionsOverview({
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
          <TransactionsTopBand
            overview={overview}
            displayCurrency={displayCurrency}
            loading={filterListLoading || isOverviewFetching}
            rangeLabel={rangeLabel}
            fromDate={overviewFromDate}
            toDate={overviewToDate}
            chartAnimationKey={chartAnimationKey}
            prefersReducedMotion={prefersReducedMotion}
            openingOutlierId={openingOutlierId}
            outlierLoadError={outlierLoadError}
            onOpenOutlierTransaction={(transactionId) => { void openOutlierTransaction(transactionId) }}
          />

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
