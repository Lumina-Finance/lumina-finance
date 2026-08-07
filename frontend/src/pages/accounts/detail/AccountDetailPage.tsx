import { useEffect, useState } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { useLocation, useNavigate, useParams } from 'react-router'
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
import { ACCOUNT_SKELETON_FADE_MS, EASE } from '@/pages/accounts/detail/constants/accountDetail'
import { IMPORT_ACCOUNT_PARAM } from '@/pages/imports/constants'
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
  const location = useLocation()
  const { accountId } = useParams<{ accountId: string }>()
  const { data: account, error } = useAccount(accountId)

  // The whole list, not just the account in view, so a transfer's row can name its counterparty
  // account. The transaction modal on this page loads it anyway, so it costs no extra request
  const { data: accounts } = useAccounts()
  const requireCurrencies = useCurrencyGuard()

  const [showTxnModal, setShowTxnModal] = useState(false)
  const [txnModalKey, setTxnModalKey] = useState(0)
  const [editingTransaction, setEditingTransaction] = useState<Transaction | null>(null)
  // The import step's archived-account notice links here to have the account unarchived, which is
  // done in this modal, so arriving that way opens it
  const wantsAccountEditModal = (location.state as { editAccount?: boolean } | null)?.editAccount === true
  const [showAccountEditModal, setShowAccountEditModal] = useState(wantsAccountEditModal)
  const [deleteExitPhase, setDeleteExitPhase] = useState<DeleteExitPhase>('idle')
  const [deletedAccountSnapshot, setDeletedAccountSnapshot] = useState<Account | null>(null)

  // Taken off the history entry once it has been read, so a reload does not reopen the modal. This
  // answers to the arrival rather than to the modal being open, since the Edit button opens the
  // same modal and would otherwise rewrite the entry every time it was pressed
  useEffect(() => {
    if (!wantsAccountEditModal) return
    navigate(`${location.pathname}${location.search}${location.hash}`, { replace: true, state: null })
  }, [location.hash, location.pathname, location.search, navigate, wantsAccountEditModal])

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
  const prefersReducedMotion = useReducedMotion() ?? false

  // The placeholder has to outlive the moment it is dropped, or there is nothing left on screen to
  // fade. The loading branch is held open until its exit finishes, and the page then enters with a
  // fade of its own so the two hand over rather than one popping in behind the other
  const [isSkeletonExiting, setIsSkeletonExiting] = useState(false)
  const [hasShownSkeleton, setHasShownSkeleton] = useState(false)
  const [wasShowingSkeleton, setWasShowingSkeleton] = useState(showSkeleton)
  if (wasShowingSkeleton !== showSkeleton) {
    setWasShowingSkeleton(showSkeleton)
    if (showSkeleton) setHasShownSkeleton(true)
    else setIsSkeletonExiting(true)
  }

  const skeletonFadeSeconds = prefersReducedMotion ? 0 : ACCOUNT_SKELETON_FADE_MS / 1000

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

  // The account rides in the address rather than in router state, so the import survives a reload
  // and can be shared, and the import page settles for itself whether it may write to that account
  const openImport = () => {
    if (!visibleAccount) return
    navigate(`/settings/imports?${IMPORT_ACCOUNT_PARAM}=${visibleAccount.id}`)
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

  // The skeleton outlasts the request by its minimum display and then by its fade, so the account
  // having arrived is not on its own a reason to leave this branch. An error is: it goes to the
  // message below at once rather than finishing an animation first
  if (!error && (isAccountLoading || showSkeleton || isSkeletonExiting)) {
    return (
      <div>
        <AccountDetailBackLink />
        <AnimatePresence onExitComplete={() => setIsSkeletonExiting(false)}>
          {showSkeleton && (
            <motion.div
              key="account-detail-skeleton"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: skeletonFadeSeconds, ease: EASE }}
            >
              <AccountDetailLoadingSkeleton />
            </motion.div>
          )}
        </AnimatePresence>
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
          // Fades in only where it is taking over from a placeholder that just faded out. Every
          // other arrival, a cached account above all, is drawn straight away as it always was
          initial={hasShownSkeleton && !prefersReducedMotion ? { opacity: 0, y: 0, filter: 'blur(0px)' } : false}
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
                closed_at: visibleAccount.closed_at,
              }}
              accounts={(accounts ?? []).map(toTransactionListAccount)}
              currency={visibleAccount.currency}
              onCreateTransaction={openCreateTransaction}
              onEditTransaction={openEditTransaction}
              onImport={openImport}
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
