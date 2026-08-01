import { useMemo } from 'react'
import { useAccounts } from '@/api/accounts'
import { useCategories } from '@/api/categories'
import { useCurrencies } from '@/api/currency'
import { useCurrencyListState } from '@/hooks/useCurrencyListState'
import { CURRENCY_LIST_LOADING } from '@/utils/currencyStatus'
import { useAuth } from '@/hooks/useAuth'
import { KIND_LABELS } from '@/pages/transactions/components/transaction-modal/constants'
import { buildInitialTransactionForm } from '@/pages/transactions/components/transaction-modal/utils/initialForm'
import { buildCurrencyOptions } from '@/pages/transactions/components/transaction-modal/utils/options'
import { isSymmetricTransferForm } from '@/pages/transactions/components/transaction-modal/utils/validation'
import type {
  CreateTransactionModalProps,
  TransactionDirection,
  TransactionFormValues,
} from '@/pages/transactions/components/transaction-modal/types'
import TransactionDetailsSection from '@/pages/transactions/components/transaction-modal/sections/DetailsSection'
import TransactionModalFooter from '@/pages/transactions/components/transaction-modal/layout/Footer'
import { ReceiptText } from 'lucide-react'
import { ModalTitledPanel } from '@/components/modal/TitledPanel'
import TransactionModalSubmitError from '@/pages/transactions/components/transaction-modal/controls/SubmitError'
import TransactionReferenceCreationModals from '@/pages/transactions/components/transaction-modal/modals/ReferenceCreationModals'
import TransactionReferencesSection from '@/pages/transactions/components/transaction-modal/sections/ReferencesSection'
import TransactionTypeDirectionSection from '@/pages/transactions/components/transaction-modal/sections/TypeDirectionSection'
import { useTransactionFormState } from '@/pages/transactions/components/transaction-modal/hooks/useFormState'
import { useTransactionReferenceCreationModals } from '@/pages/transactions/components/transaction-modal/hooks/useReferenceCreationModals'
import { useCategoryField } from '@/pages/transactions/components/transaction-modal/hooks/useCategoryField'
import { useMerchantField } from '@/pages/transactions/components/transaction-modal/hooks/useMerchantField'
import { useTagField } from '@/pages/transactions/components/transaction-modal/hooks/useTagField'
import { useAccountField } from '@/pages/transactions/components/transaction-modal/hooks/useAccountField'
import { useDeferredTransactionRefresh } from '@/pages/transactions/components/transaction-modal/hooks/useDeferredRefresh'
import { useTransactionDeletion } from '@/pages/transactions/components/transaction-modal/hooks/useDeletion'
import { useTransactionSubmit } from '@/pages/transactions/components/transaction-modal/hooks/useSubmit'

/**
 * Modal for creating or editing a transaction, including symmetric transfers that record a
 * linked debit and credit across two accounts, and inline creation of merchants, categories,
 * and tags without leaving the form
 *
 * Cache invalidation for the affected accounts and transaction lists is deferred until the
 * modal closes, so a session of edits refreshes the page once instead of behind the open
 * modal after every save
 */
export default function CreateTransactionModal({
  open,
  onClose,
  transaction,
  defaultAccountId,
  defaultCurrency,
  readOnly: readOnlyProp = false,
}: CreateTransactionModalProps) {
  const editing = !!transaction
  const { user } = useAuth()
  const { data: accounts = [] } = useAccounts()
  const { data: categories = [] } = useCategories()
  const { data: currencies = [] } = useCurrencies()
  const currencyState = useCurrencyListState()
  const selectableAccounts = useMemo(
    () => accounts.filter((account) => !account.is_archived),
    [accounts],
  )

  // Build the initial form from the existing transaction (edit) or sensible defaults (create)
  const initialForm = useMemo<TransactionFormValues>(() => {
    return buildInitialTransactionForm({
      transaction,
      categories,
      currencies,
      selectableAccounts,
      defaultAccountId,
      defaultCurrency,
      timeZone: user?.tz,
    })
  }, [transaction, categories, currencies, defaultAccountId, defaultCurrency, selectableAccounts, user?.tz])

  const {
    form,
    setForm,
    setFieldErrors,
    setTouched,
    submitError,
    setSubmitError,
    submitErrorTitle,
    setSubmitErrorTitle,
    directionHighlightKey,
    clearError,
    applyKindChange,
    handleField,
    handleAmountChange,
    handleBlur,
    showError,
  } = useTransactionFormState(initialForm)

  const selectedAccount = useMemo(
    () => accounts.find((account) => account.id === form.account_id),
    [accounts, form.account_id],
  )
  const selectedOtherAccount = useMemo(
    () => accounts.find((account) => account.id === form.other_account_id),
    [accounts, form.other_account_id],
  )
  const readOnly = editing && (readOnlyProp || Boolean(selectedAccount?.is_archived))

  const { merchantModal, categoryModal, tagModal } = useTransactionReferenceCreationModals()

  const categoryField = useCategoryField({
    categories,
    form,
    applyKindChange,
    clearError,
    closeModal: categoryModal.closeModal,
  })

  const merchantField = useMerchantField({
    open,
    categoryById: categoryField.categoryById,
    categoryOptions: categoryField.categoryOptions,
    selectedCategory: categoryField.selectedCategory,
    form,
    setForm,
    applyKindChange,
    clearError,
    readOnly,
    setSubmitError,
    setSubmitErrorTitle,
    closeModal: merchantModal.closeModal,
  })

  const tagField = useTagField({
    open,
    groupId: selectedAccount?.group_id,
    form,
    setForm,
    transactionTags: transaction?.tags,
    closeModal: tagModal.closeModal,
  })

  const accountField = useAccountField({
    accounts,
    selectableAccounts,
    editing,
    selectedAccount,
    form,
    setForm,
    clearError,
    tagById: tagField.tagById,
  })

  const currencyOptions = useMemo(
    () => buildCurrencyOptions(currencies, form.currency),
    [currencies, form.currency],
  )
  const selectedCurrency = currencies.find((c) => c.id === form.currency)
  const selectedCurrencySymbol = selectedCurrency?.symbol ?? ''
  const selectedCurrencyExponent = selectedCurrency?.minor_unit_exponent ?? 2
  // Only reachable while editing, since a create click is refused before the modal opens
  const isAmountLocked = currencyState !== 'ready'

  const { openRef, recordCreatedAccountId, flushDeferredRefresh, closeModal } = useDeferredTransactionRefresh({
    open,
    onClose,
  })

  const { deleteLoading, deleteTransaction, applyPendingDeletion } = useTransactionDeletion({
    transaction,
    readOnly,
    closeModal,
    setSubmitError,
    setSubmitErrorTitle,
  })

  const {
    handleSubmit,
    submitLoading,
    isPending,
    keepOpenAfterCreate,
    setKeepOpenAfterCreate,
    runningBalance,
  } = useTransactionSubmit({
    editing,
    transaction,
    form,
    setForm,
    setFieldErrors,
    setTouched,
    setSubmitError,
    setSubmitErrorTitle,
    readOnly,
    accounts,
    selectedAccount,
    selectedOtherAccount,
    selectedCurrencyExponent,
    isAmountLocked,
    isBalanceAdjustmentCategory: categoryField.isBalanceAdjustmentCategory,
    deleteLoading,
    openRef,
    recordCreatedAccountId,
    flushDeferredRefresh,
    closeModal,
  })


  const showRunningBalance = !editing && keepOpenAfterCreate && !!selectedAccount
  const isSymmetricTransfer = isSymmetricTransferForm(form)

  // A symmetric transfer shows its direction relative to the account being viewed, so the toggle
  // reflects whether that account is the source or destination instead of a user choice. It falls
  // back to the unselected state when the viewed account is on neither leg or no account is in view
  const symmetricDisplayDirection: TransactionDirection | '' = !defaultAccountId
    ? ''
    : form.account_id === defaultAccountId
      ? 'debit'
      : form.other_account_id === defaultAccountId
        ? 'credit'
        : ''
  const directionValue = isSymmetricTransfer ? symmetricDisplayDirection : form.direction

  return (
    <>
      <ModalTitledPanel
        open={open}
        titleId="create-txn-title"
        title={editing ? 'Edit Transaction' : 'Add Transaction'}
        eyebrow={editing ? 'Existing transaction' : `${KIND_LABELS[form.kind]} transaction`}
        headerStatus={readOnly ? 'Archived account' : undefined}
        RailIcon={ReceiptText}
        railLabel="Transaction"
        animateHeight
        onClose={closeModal}
        onExitComplete={applyPendingDeletion}
        onSubmit={handleSubmit}
        footer={(
          <TransactionModalFooter
            editing={editing}
            isPending={isPending}
            readOnly={readOnly}
            submitLoading={submitLoading}
            deleteLoading={deleteLoading}
            keepOpenAfterCreate={keepOpenAfterCreate}
            onKeepOpenAfterCreateChange={setKeepOpenAfterCreate}
            onCancel={closeModal}
            onDelete={deleteTransaction}
          />
        )}
      >
        <div className="space-y-5">
          <TransactionTypeDirectionSection
            kind={form.kind}
            direction={directionValue}
            editing={editing}
            readOnly={readOnly}
            directionDisabled={isSymmetricTransfer}
            directionHighlightKey={directionHighlightKey}
            onKindChange={applyKindChange}
            onDirectionChange={(value) => handleField('direction', value)}
          />

          <TransactionReferencesSection
            accountOptions={accountField.accountOptions}
            selectedArchivedAccountOption={accountField.selectedArchivedAccountOption}
            accountValue={form.account_id}
            accountError={showError('account_id')}
            accountPlaceholder={accounts.length === 0 ? 'No accounts yet' : 'Select account...'}
            runningBalance={showRunningBalance && selectedAccount
              ? { amount: runningBalance, currency: selectedAccount.currency }
              : undefined}
            kind={form.kind}

            // A pair always debits the account above and credits the receiving one, whatever the
            // direction toggle was left on before the checkbox disabled it
            direction={isSymmetricTransfer ? 'debit' : form.direction}
            isSymmetricTransfer={form.symmetric_transfer}
            otherAccountOptions={accountField.otherAccountOptions}
            otherAccountValue={form.other_account_id}
            otherAccountError={showError('other_account_id')}
            merchantOptions={merchantField.merchantOptions}
            selectedMerchantOption={merchantField.selectedMerchantOption}
            merchantValue={form.merchant_id}
            merchantError={showError('merchant_id')}
            merchantSearch={merchantField.search}
            merchantLoading={merchantField.showLoading}
            merchantLoadingText={merchantField.loadingText}
            merchantHideOptionsWhileLoading={merchantField.showInitialLoading}
            merchantHasMore={merchantField.hasMore}
            categoryOptions={categoryField.categoryOptions}
            categoryValue={form.category_id}
            categoryError={showError('category_id')}
            isBalanceAdjustmentCategory={categoryField.isBalanceAdjustmentCategory}
            showMerchantDefaultCategoryAction={merchantField.showMerchantDefaultCategoryAction}
            merchantDefaultCategoryActionLabel={merchantField.merchantDefaultCategoryActionLabel}
            merchantDefaultCategoryPending={merchantField.merchantDefaultCategoryPending}
            tagOptions={tagField.tagOptions}
            tagsDisabled={!form.account_id}
            tagSearch={tagField.search}
            tagLoading={tagField.showLoading}
            tagLoadingText={tagField.loadingText}
            tagHideOptionsWhileLoading={tagField.showInitialLoading}
            tagHasMore={tagField.hasMore}
            selectedTags={tagField.selectedTags}
            readOnly={readOnly}
            onAccountChange={accountField.handleAccountChange}
            onSymmetricTransferChange={accountField.handleSymmetricTransferChange}
            onOtherAccountChange={accountField.handleOtherAccountChange}
            onMerchantChange={merchantField.handleMerchantChange}
            onMerchantSearchChange={merchantField.setSearch}
            onMerchantSearchCommit={merchantField.setActiveSearch}
            onMerchantLoadMore={merchantField.loadMore}
            onCreateMerchant={merchantModal.openModal}
            onMakeMerchantDefaultCategory={merchantField.handleMakeMerchantDefaultCategory}
            onCategoryChange={categoryField.handleCategoryChange}
            onCreateCategory={categoryModal.openModal}
            onTagChange={tagField.handleTagChange}
            onTagSearchChange={tagField.setSearch}
            onTagSearchCommit={tagField.setActiveSearch}
            onTagLoadMore={tagField.loadMore}
            onCreateTag={tagModal.openModal}
            onRemoveTag={tagField.handleRemoveTag}
          />

          <TransactionDetailsSection
            date={form.date}
            dateError={showError('date')}
            currencyOptions={currencyOptions}
            currencyValue={form.currency}
            currencyPlaceholder={isAmountLocked ? CURRENCY_LIST_LOADING : 'Select...'}
            selectedCurrencySymbol={selectedCurrencySymbol}
            currencyExponent={selectedCurrencyExponent}
            currencyState={currencyState}
            amount={form.amount}
            amountError={showError('amount')}
            notes={form.notes}
            readOnly={readOnly}
            onDateChange={(value) => handleField('date', value)}
            onDateBlur={() => handleBlur('date')}
            onAmountChange={handleAmountChange}
            onAmountBlur={() => handleBlur('amount')}
            onNotesChange={(value) => handleField('notes', value)}
          />

          <TransactionModalSubmitError error={submitError} title={submitErrorTitle} />
        </div>
      </ModalTitledPanel>
      <TransactionReferenceCreationModals
        parentOpen={open}
        merchantModalKey={merchantModal.remountKey}
        merchantOpen={merchantModal.open}
        merchantInitialName={merchantModal.name}
        merchantCategoryOptions={merchantField.merchantDefaultCategoryOptions}
        onCloseMerchant={merchantModal.closeModal}
        onMerchantCreated={merchantField.handleMerchantCreated}
        categoryModalKey={categoryModal.remountKey}
        categoryOpen={categoryModal.open}
        categoryInitialName={categoryModal.name}
        categoryInitialKind={form.kind}
        onCloseCategory={categoryModal.closeModal}
        onCategoryCreated={categoryField.handleCategoryCreated}
        tagModalKey={tagModal.remountKey}
        tagOpen={tagModal.open}
        tagInitialName={tagModal.name}
        tagGroupId={selectedAccount?.group_id ?? null}
        onCloseTag={tagModal.closeModal}
        onTagCreated={tagField.handleTagCreated}
      />
    </>
  )
}
