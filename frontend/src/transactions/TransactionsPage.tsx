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
import { transactionKeys, transactionOverviewKeys } from '@/api/queryKeys'
import { useFocusRefetch } from '@/hooks/useFocusRefetch'
import CreateTransactionModal from '@/components/CreateTransactionModal'
import TransactionListSection from '@/transactions/components/TransactionListSection'
import TransactionsTopBand from '@/transactions/components/TransactionsTopBand'
import type { TransactionListFilters } from '@/transactions/types/transactionList'

function formatOverviewRangeLabel(from: string, to: string): string {
  // Treat YYYY-MM-DD inputs as calendar dates so labels do not shift by local timezone.
  const fmt = new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  })
  const parse = (value: string) => new Date(`${value}T00:00:00Z`)
  return `${fmt.format(parse(from))} – ${fmt.format(parse(to))}`
}

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

  useFocusRefetch([
    { queryKey: transactionKeys.all, exact: false },
    { queryKey: transactionOverviewKeys.all, exact: false },
  ])

  const openCreateModal = () => {
    setEditingTransaction(null)
    setCreateModalKey((key) => key + 1)
    setShowCreateModal(true)
  }

  const openEditModal = (transaction: Transaction) => {
    setEditingTransaction(transaction)
    setCreateModalKey((key) => key + 1)
    setShowCreateModal(true)
  }

  const openOutlierTransaction = async (transactionId: string) => {
    // Outliers may not be in the currently loaded list page, so fall back to a detail fetch.
    const loadedTransaction = latestTransactionsRef.current.find((transaction) => transaction.id === transactionId)
    if (loadedTransaction) {
      openEditModal(loadedTransaction)
      return
    }

    setOutlierOpenError(null)
    setOpeningOutlierId(transactionId)
    try {
      const transaction = await queryClient.fetchQuery({
        queryKey: transactionKeys.detail(transactionId),
        queryFn: () => fetchTransaction(transactionId),
        staleTime: 10 * 60 * 1000,
      })
      openEditModal(transaction)
    } catch {
      setOutlierOpenError('Unable to open transaction')
    } finally {
      setOpeningOutlierId((current) => (current === transactionId ? null : current))
    }
  }

  // Default overview metrics to the current month in the user's configured timezone.
  const { monthStart, today } = useMemo(() => {
    const fmt = new Intl.DateTimeFormat('en-CA', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      timeZone: user!.tz,
    })
    const todayStr = fmt.format(new Date())
    const monthStartStr = `${todayStr.slice(0, 7)}-01`
    return { monthStart: monthStartStr, today: todayStr }
  }, [user])

  const overviewFromDate = filters.from_date ?? monthStart
  const overviewToDate = filters.to_date ?? today
  const rangeLabel = useMemo(
    () => formatOverviewRangeLabel(overviewFromDate, overviewToDate),
    [overviewFromDate, overviewToDate],
  )
  // Overview supports account/date filters; category filtering remains list-only.
  const { data: overview, isFetching: isOverviewFetching } = useTransactionsOverview({
    account_id: filters.account_id,
    from_date: overviewFromDate,
    to_date: overviewToDate,
  })
  // Force chart remounts when filters change so the pre-refactor animation behavior stays intact.
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

      <div className="space-y-6">
        <div className="space-y-3">
          <TransactionsTopBand
            overview={overview}
            displayCurrency={displayCurrency}
            filterListLoading={filterListLoading}
            rangeLabel={rangeLabel}
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
          isExternalFetching={isOverviewFetching}
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
