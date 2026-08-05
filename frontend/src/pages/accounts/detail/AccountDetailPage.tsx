import { useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { useNavigate, useParams } from 'react-router'
import { useAccount, useAccounts, type Account } from '@/api/accounts'
import { useTaxAdvantagedCategory } from '@/api/tax-advantaged-categories'
import type { Transaction } from '@/api/transactions'
import AccountIdentityCard from '@/pages/accounts/detail/components/identity/Card'
import AccountDetailBackLink from '@/pages/accounts/detail/components/BackLink'
import AccountDetailLoadingSkeleton from '@/pages/accounts/detail/components/LoadingSkeleton'
import BalanceChartCard from '@/pages/accounts/detail/components/balance-chart/Card'
import EditAccountIdentityModal from '@/pages/accounts/detail/components/edit-identity/Modal'
import MonthlyCashFlowCard from '@/pages/accounts/detail/components/monthly-cash-flow/Card'
import { TopCategoriesBySpendingCard } from '@/pages/accounts/detail/components/spending-breakdown/TopCategoriesCard'
import { TopMerchantsBySpendingCard } from '@/pages/accounts/detail/components/spending-breakdown/TopMerchantsCard'
import { EASE } from '@/pages/accounts/detail/constants/accountDetail'
import TransactionListSection from '@/pages/transactions/components/ListSection'
import { toTransactionListAccount } from '@/pages/transactions/types/transactionList'
import CreateTransactionModal from '@/pages/transactions/components/transaction-modal/Modal'
import { useCurrencyGuard } from '@/hooks/useCurrencyGuard'
import { useSkeletonVisibility } from '@/pages/accounts/detail/hooks/useSkeletonVisibility'

type DeleteExitPhase = 'idle' | 'pending' | 'modal' | 'page'

/**
 * Detail page for a single account, showing its identity card, balance chart, spending and cash
 * flow breakdowns and its transactions, with modals for editing the account and its transactions
 *
 * Deleting the account holds on to a copy of it so the page still has something to render while
 * the modal and then the page itself animate out, and the return to the accounts list waits for
 * that exit to finish. A failed deletion drops the copy and leaves the page as it was
 */
export default function AccountDetailPage() {
  const navigate = useNavigate()
  const { accountId } = useParams<{ accountId: string }>()
  const { data: account, error } = useAccount(accountId)

  // The whole list, not just the account in view, so a transfer's row can name its counterparty
  // account. The transaction modal on this page loads it anyway, so it costs no extra request
  const { data: accounts } = useAccounts()
  const requireCurrencies = useCurrencyGuard()

  const [showTxnModal, setShowTxnModal] = useState(false)
  const [txnModalKey, setTxnModalKey] = useState(0)
  const [editingTransaction, setEditingTransaction] = useState<Transaction | null>(null)
  const [showAccountEditModal, setShowAccountEditModal] = useState(false)
  const [deleteExitPhase, setDeleteExitPhase] = useState<DeleteExitPhase>('idle')
  const [deletedAccountSnapshot, setDeletedAccountSnapshot] = useState<Account | null>(null)

  const visibleAccount = account ?? (deleteExitPhase !== 'idle' ? deletedAccountSnapshot : null)
  const linkedTaxAdvantagedCategoryId = visibleAccount?.group_id === null ? visibleAccount.tax_advantaged_category_id : null
  const {
    data: linkedTaxAdvantagedCategory,
    error: linkedTaxAdvantagedCategoryError,
  } = useTaxAdvantagedCategory(linkedTaxAdvantagedCategoryId)

  // A deletion holds a copy of the account, so this stays false throughout one and the page keeps
  // rendering the copy rather than dropping into the loading branch mid-exit
  const isAccountLoading = !visibleAccount && !error
  const showSkeleton = useSkeletonVisibility(isAccountLoading)

  const openCreateTransaction = () => {
    if (visibleAccount?.is_archived) return

    requireCurrencies(() => {
      setEditingTransaction(null)
      setTxnModalKey((key) => key + 1)
      setShowTxnModal(true)
    })
  }

  const openEditTransaction = (transaction: Transaction) => {
    setEditingTransaction(transaction)
    setTxnModalKey((key) => key + 1)
    setShowTxnModal(true)
  }

  const openAccountEditModal = () => {
    if (!visibleAccount) return
    setShowAccountEditModal(true)
  }

  const handleAccountDeleteStarted = (deletingAccount: Account) => {
    setDeletedAccountSnapshot(deletingAccount)
    setDeleteExitPhase('pending')
  }

  const handleAccountDeleted = (deletedAccount: Account) => {
    setDeletedAccountSnapshot(deletedAccount)
    setShowAccountEditModal(false)
    setDeleteExitPhase('modal')
  }

  const handleAccountDeleteFailed = () => {
    setDeleteExitPhase('idle')
    setDeletedAccountSnapshot(null)
  }

  const handleAccountEditModalExitComplete = () => {
    if (deleteExitPhase === 'modal') setDeleteExitPhase('page')
  }

  const handlePageExitComplete = () => {
    if (deleteExitPhase === 'page') navigate('/accounts', { replace: true })
  }

  // The skeleton outlasts the request by its minimum display, so the account having arrived is not
  // on its own a reason to leave this branch. An error is: it goes to the message below at once
  // rather than finishing an animation first
  if (!error && (isAccountLoading || showSkeleton)) {
    return (
      <div>
        <AccountDetailBackLink />
        {showSkeleton && <AccountDetailLoadingSkeleton />}
      </div>
    )
  }

  if ((error && deleteExitPhase === 'idle') || !visibleAccount) {
    return (
      // Fills the height the page content area has left after its own padding, which is the whole
      // viewport on mobile and the space beside the sidebar on desktop, so the message sits in the
      // middle of what the reader can see. The padding subtracted here is the main element's own,
      // set in App.tsx, and the two have to be changed together
      <div className="relative flex min-h-[calc(100dvh-3.5rem)] flex-col items-center justify-center text-center min-[1050px]:min-h-[calc(100dvh-3.75rem)]">
        {/* Out of the centred flow, so the message is centred against the area rather than against
            the space left under the link */}
        <div className="absolute left-0 top-0">
          <AccountDetailBackLink />
        </div>

        <h1 className="app-page-title">Account not found</h1>
        <p className="app-page-description">We couldn't load this account. It may have been deleted.</p>
      </div>
    )
  }

  return (
    <AnimatePresence mode="wait" onExitComplete={handlePageExitComplete}>
      {deleteExitPhase !== 'page' && (
        <motion.div
          key="account-detail-page"
          initial={false}
          animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
          exit={{ opacity: 0, y: 10, filter: 'blur(2px)' }}
          transition={{ duration: 0.22, ease: EASE }}
        >
          <AccountDetailBackLink />

          <div className="grid grid-cols-1 gap-5 min-[750px]:grid-cols-[320px_minmax(0,1fr)]">
            <AccountIdentityCard
              account={visibleAccount}
              linkedTaxAdvantagedCategory={linkedTaxAdvantagedCategory}
              linkedTaxAdvantagedCategoryError={linkedTaxAdvantagedCategoryError}
              onEdit={openAccountEditModal}
            />

            <BalanceChartCard account={visibleAccount} />
          </div>

          <div className="mt-5 grid grid-cols-1 gap-5 min-[750px]:grid-cols-2 min-[1600px]:grid-cols-3">
            <TopCategoriesBySpendingCard account={visibleAccount} />
            <TopMerchantsBySpendingCard account={visibleAccount} />
            <div className="min-[750px]:col-span-2 min-[1600px]:col-span-1">
              <MonthlyCashFlowCard account={visibleAccount} />
            </div>
          </div>

          <div className="mt-5">
            <h2 className="mb-4 font-serif text-4xl font-medium leading-none">Transactions</h2>
            <TransactionListSection
              key={visibleAccount.id}
              fixedAccount={{
                id: visibleAccount.id,
                name: visibleAccount.name,
                currency: visibleAccount.currency,
                institution: visibleAccount.institution,
                is_archived: visibleAccount.is_archived,
              }}
              accounts={(accounts ?? []).map(toTransactionListAccount)}
              currency={visibleAccount.currency}
              onCreateTransaction={openCreateTransaction}
              onEditTransaction={openEditTransaction}
            />
          </div>

          <CreateTransactionModal
            key={txnModalKey}
            open={showTxnModal}
            onClose={() => setShowTxnModal(false)}
            transaction={editingTransaction ?? undefined}
            defaultAccountId={visibleAccount.id}
            defaultCurrency={visibleAccount.currency}
            readOnly={Boolean(editingTransaction && visibleAccount.is_archived)}
          />

          <EditAccountIdentityModal
            open={showAccountEditModal}
            account={visibleAccount}
            onClose={() => setShowAccountEditModal(false)}
            onExitComplete={handleAccountEditModalExitComplete}
            onDeleteStarted={handleAccountDeleteStarted}
            onDeleted={handleAccountDeleted}
            onDeleteFailed={handleAccountDeleteFailed}
          />
        </motion.div>
      )}
    </AnimatePresence>
  )
}
