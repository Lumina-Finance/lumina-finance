import { useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { useNavigate, useParams } from 'react-router'
import { useAccount, type Account } from '@/api/accounts'
import { useTaxAdvantagedCategory } from '@/api/taxAdvantagedCategories'
import type { Transaction } from '@/api/transactions'
import AccountIdentityCard from '@/pages/accounts/detail/components/identity/Card'
import AccountDetailBackLink from '@/pages/accounts/detail/components/BackLink'
import BalanceChartCard from '@/pages/accounts/detail/components/balance-chart/Card'
import EditAccountIdentityModal from '@/pages/accounts/detail/components/edit-identity/Modal'
import MonthlyCashFlowCard from '@/pages/accounts/detail/components/monthly-cash-flow/Card'
import { TopCategoriesBySpendingCard } from '@/pages/accounts/detail/components/spending-breakdown/TopCategoriesCard'
import { TopMerchantsBySpendingCard } from '@/pages/accounts/detail/components/spending-breakdown/TopMerchantsCard'
import { EASE } from '@/pages/accounts/detail/constants/accountDetail'
import TransactionListSection from '@/pages/transactions/components/ListSection'
import CreateTransactionModal from '@/pages/transactions/components/transaction-modal/Modal'

type DeleteExitPhase = 'idle' | 'pending' | 'modal' | 'page'

export default function AccountDetailPage() {
  const navigate = useNavigate()
  const { accountId } = useParams<{ accountId: string }>()
  const { data: account, error } = useAccount(accountId)

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

  const openCreateTransaction = () => {
    if (visibleAccount?.is_archived) return

    setEditingTransaction(null)
    setTxnModalKey((key) => key + 1)
    setShowTxnModal(true)
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

  if (!visibleAccount && !error) {
    return (
      <div>
        <AccountDetailBackLink />
      </div>
    )
  }

  if ((error && deleteExitPhase === 'idle') || !visibleAccount) {
    return (
      <div>
        <AccountDetailBackLink />
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

          <AnimatePresence onExitComplete={handleAccountEditModalExitComplete}>
            {showAccountEditModal && (
              <EditAccountIdentityModal
                key="edit-account-modal"
                account={visibleAccount}
                onClose={() => setShowAccountEditModal(false)}
                onDeleteStarted={handleAccountDeleteStarted}
                onDeleted={handleAccountDeleted}
                onDeleteFailed={handleAccountDeleteFailed}
              />
            )}
          </AnimatePresence>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
