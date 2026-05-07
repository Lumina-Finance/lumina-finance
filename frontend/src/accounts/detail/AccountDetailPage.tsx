import { useState } from 'react'
import { AnimatePresence } from 'motion/react'
import { useParams } from 'react-router-dom'
import { useAccount } from '@/api/accounts'
import { useTaxAdvantagedPlan } from '@/api/taxAdvantagedPlans'
import type { Transaction } from '@/api/transactions'
import CreateTransactionModal from '@/components/CreateTransactionModal'
import AccountIdentityCard from '@/accounts/detail/components/AccountIdentityCard'
import BackLink from '@/accounts/detail/components/BackLink'
import BalanceChartCard from '@/accounts/detail/components/BalanceChartCard'
import EditAccountIdentityModal from '@/accounts/detail/components/EditAccountIdentityModal'
import MonthlyCashFlowCard from '@/accounts/detail/components/MonthlyCashFlowCard'
import { TopCategoriesBySpendingCard, TopMerchantsBySpendingCard } from '@/accounts/detail/components/SpendingBreakdownCards'
import TransactionListSection from '@/transactions/components/TransactionListSection'

export default function AccountDetailPage() {
  const { accountId } = useParams<{ accountId: string }>()
  const { data: account, error } = useAccount(accountId)
  const linkedTaxAdvantagedPlanId = account?.group_id === null ? account.tax_advantaged_plan_id : null
  const {
    data: linkedTaxAdvantagedPlan,
    error: linkedTaxAdvantagedPlanError,
  } = useTaxAdvantagedPlan(linkedTaxAdvantagedPlanId)

  const [showTxnModal, setShowTxnModal] = useState(false)
  const [txnModalKey, setTxnModalKey] = useState(0)
  const [editingTransaction, setEditingTransaction] = useState<Transaction | null>(null)
  const [showAccountEditModal, setShowAccountEditModal] = useState(false)

  const openCreateTransaction = () => {
    setEditingTransaction(null)
    setTxnModalKey((key) => key + 1)
    setShowTxnModal(true)
  }

  const openEditTransaction = (transaction: Transaction) => {
    setEditingTransaction(transaction)
    setTxnModalKey((key) => key + 1)
    setShowTxnModal(true)
  }

  if (!account && !error) {
    return (
      <div>
        <BackLink />
      </div>
    )
  }

  if (error || !account) {
    return (
      <div>
        <BackLink />
        <h1 className="app-page-title">Account not found</h1>
        <p className="app-page-description">We couldn't load this account. It may have been deleted.</p>
      </div>
    )
  }

  return (
    <div>
      <BackLink />

      <div className="grid grid-cols-[320px_minmax(0,1fr)] gap-5">
        <AccountIdentityCard
          account={account}
          linkedTaxAdvantagedPlan={linkedTaxAdvantagedPlan}
          linkedTaxAdvantagedPlanError={linkedTaxAdvantagedPlanError}
          onEdit={() => setShowAccountEditModal(true)}
        />

        <BalanceChartCard account={account} />
      </div>

      <div className="mt-5 grid grid-cols-3 gap-5">
        <TopCategoriesBySpendingCard account={account} />
        <TopMerchantsBySpendingCard account={account} />
        <MonthlyCashFlowCard account={account} />
      </div>

      <div className="mt-5">
        <h2 className="mb-4 font-serif text-4xl font-medium leading-none">Transactions</h2>
        <TransactionListSection
          key={account.id}
          fixedAccount={{
            id: account.id,
            name: account.name,
            currency: account.currency,
            institution: account.institution,
          }}
          currency={account.currency}
          onCreateTransaction={openCreateTransaction}
          onEditTransaction={openEditTransaction}
        />
      </div>

      <CreateTransactionModal
        key={txnModalKey}
        open={showTxnModal}
        onClose={() => setShowTxnModal(false)}
        transaction={editingTransaction ?? undefined}
        defaultAccountId={account.id}
        defaultCurrency={account.currency}
      />

      <AnimatePresence>
        {showAccountEditModal && (
          <EditAccountIdentityModal
            key="edit-account-modal"
            account={account}
            onClose={() => setShowAccountEditModal(false)}
          />
        )}
      </AnimatePresence>
    </div>
  )
}
