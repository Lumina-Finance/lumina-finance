import { useCallback, useMemo, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useReducedMotion } from 'motion/react'
import { useAuth } from '@/hooks/useAuth'
import { useAccounts } from '@/api/accounts'
import {
  fetchTransaction,
  useTransactionsOverview,
  type Transaction,
} from '@/api/transactions'
import { transactionKeys } from '@/api/cache/queryKeys'
import TransactionListSection from '@/transactions/components/TransactionListSection'
import CreateTransactionModal from '@/transactions/components/transaction-modal/CreateTransactionModal'
import TransactionsTopBand from '@/transactions/components/TransactionsTopBand'
import type { TransactionListFilters } from '@/transactions/types/transactionList'
import {
  formatOverviewRangeLabel,
  getCurrentMonthOverviewRange,
} from '@/transactions/utils/date'

/**
 * Renders the transactions page overview, filters, list, and transaction modal workflows
 */
export default function TransactionsPage() {
  const prefersReducedMotion = useReducedMotion()
  const queryClient = useQueryClient()
  const { user } = useAuth()
  const { data: accounts } = useAccounts()
  const displayCurrency = user!.base_currency
  const latestTransactionsRef = useRef<Transaction[]>([])
  const [filters, setFilters] = useState<TransactionListFilters>({})
  const [filterListLoading, setFilterListLoading] = useState(false)
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [createModalKey, setCreateModalKey] = useState(0)
  const [editingTransaction, setEditingTransaction] = useState<Transaction | null>(null)
  const [openingOutlierId, setOpeningOutlierId] = useState<string | null>(null)
  const [outlierOpenError, setOutlierOpenError] = useState<string | null>(null)

  /**
   * Opens the transaction modal in create mode and resets any previous edit state
   */
  const openCreateModal = () => {
    setEditingTransaction(null)
    setCreateModalKey((key) => key + 1)
    setShowCreateModal(true)
  }

  /**
   * Opens the transaction modal in edit mode unless the owning account is archived
   */
  const openEditModal = (transaction: Transaction) => {
    const account = accounts?.find((item) => item.id === transaction.account_id)
    if (account?.is_archived) return

    setEditingTransaction(transaction)
    setCreateModalKey((key) => key + 1)
    setShowCreateModal(true)
  }

  /**
   * Opens a top-band outlier transaction from the loaded list or a cached detail fetch
   */
  const openOutlierTransaction = async (transactionId: string) => {
    setOutlierOpenError(null)

    // Outliers may not be in the currently loaded list page, so fall back to a detail fetch
    const loadedTransaction = latestTransactionsRef.current.find((transaction) => transaction.id === transactionId)
    if (loadedTransaction) {
      const account = accounts?.find((item) => item.id === loadedTransaction.account_id)
      if (account?.is_archived) {
        setOutlierOpenError('Archived account transactions are read-only')
        return
      }
      openEditModal(loadedTransaction)
      return
    }

    setOpeningOutlierId(transactionId)
    try {
      const transaction = await queryClient.fetchQuery({
        queryKey: transactionKeys.detail(transactionId),
        queryFn: () => fetchTransaction(transactionId),
        staleTime: 10 * 60 * 1000,
      })
      const account = accounts?.find((item) => item.id === transaction.account_id)
      if (account?.is_archived) {
        setOutlierOpenError('Archived account transactions are read-only')
        return
      }
      openEditModal(transaction)
    } catch {
      setOutlierOpenError('Unable to open transaction')
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
  // Overview supports account and date filters while category filtering remains list-only
  const { data: overview, isFetching: isOverviewFetching } = useTransactionsOverview({
    account_id: filters.account_id,
    from_date: overviewFromDate,
    to_date: overviewToDate,
  })

  // Chart remounts preserve the pre-refactor animation timing when filters change
  const chartAnimationKey = [
    filters.account_id ?? 'all-accounts',
    filters.category_id ?? 'all-categories',
    overviewFromDate,
    overviewToDate,
  ].join('|')
  const transactionAccounts = useMemo(
    () => (accounts ?? []).map((account) => ({
      id: account.id,
      name: account.name,
      currency: account.currency,
      institution: account.institution,
      is_archived: account.is_archived,
    })),
    [accounts],
  )
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
            outlierOpenError={outlierOpenError}
            onOpenOutlierTransaction={(transactionId) => { void openOutlierTransaction(transactionId) }}
          />

          <div
            style={{
              height: 2,
              background: 'var(--app-accent)',
              opacity: 0.35,
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
      />
    </div>
  )
}
