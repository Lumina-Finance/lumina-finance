import { useMemo, useState } from 'react'
import { useAccounts } from '@/api/accounts'
import { useTransaction } from '@/api/transactions'
import { useBankLinksByAccount, useRestoreBankValue, type EditableBankField } from '@/api/bank-sync'
import type { Transaction } from '@/api/transactions'
import { useCategories } from '@/api/categories'
import { useCurrencies } from '@/api/currency'
import { useCurrencyListState } from '@/hooks/useCurrencyListState'
import { CURRENCY_LIST_LOADING } from '@/utils/currencyStatus'
import { formatCurrencySymbol } from '@/utils/formatCurrency'
import { DEFAULT_MINOR_UNIT_EXPONENT, findCurrencyExponent } from '@/utils/moneyInput'
import { useAuth } from '@/hooks/useAuth'
import { getTodayYmd } from '@/utils/date'
import { KIND_LABELS } from '@/components/transactions/transaction-modal/constants'
import { buildInitialTransactionForm } from '@/components/transactions/transaction-modal/utils/initialForm'
import { buildCurrencyOptions } from '@/components/transactions/transaction-modal/utils/options'
import {
  getTransactionProblems,
  isSymmetricTransferForm,
} from '@/components/transactions/transaction-modal/utils/validation'
import {
  getTransactionFieldLayout,
  orderAccountFields,
} from '@/components/transactions/transaction-modal/utils/accountFields'
import { useRefusedSubmit } from '@/hooks/useRefusedSubmit'
import { useMoneyFormatters } from '@/hooks/useMoneyFormatters'
import { usePendingLinks } from '@/components/transactions/transaction-modal/hooks/usePendingLinks'
import { useRefundRoom } from '@/components/transactions/transaction-modal/hooks/useRefundRoom'
import { getBankMoveRefusal } from '@/components/transactions/transaction-modal/utils/bankMove'
import { getBankValueCaptions } from '@/components/transactions/transaction-modal/utils/bankValues'
import { amountToInputString } from '@/components/transactions/transaction-modal/utils/money'
import { getSuppliedDays } from '@/components/transactions/transaction-modal/utils/suppliedDays'
import type {
  CreateTransactionModalProps,
  TransactionFormFieldErrors,
  TransactionFormValues,
} from '@/components/transactions/transaction-modal/types'
import TransactionDetailsSection from '@/components/transactions/transaction-modal/sections/DetailsSection'
import TransactionModalFooter from '@/components/transactions/transaction-modal/layout/Footer'
import { ReceiptText } from 'lucide-react'
import { ModalTitledPanel } from '@/components/modal/TitledPanel'
import { FormError } from '@/components/forms/FormError'
import TransactionBankSourcePanel from '@/components/transactions/transaction-modal/controls/BankSourcePanel'
import TransactionBankValueCaption from '@/components/transactions/transaction-modal/controls/BankValueCaption'
import TransactionReferenceCreationModals from '@/components/transactions/transaction-modal/modals/ReferenceCreationModals'
import TransactionReferencesSection from '@/components/transactions/transaction-modal/sections/ReferencesSection'
import TransactionTypeDirectionSection from '@/components/transactions/transaction-modal/sections/TypeDirectionSection'
import { useTransactionFormState } from '@/components/transactions/transaction-modal/hooks/useFormState'
import { useTransactionReferenceCreationModals } from '@/components/transactions/transaction-modal/hooks/useReferenceCreationModals'
import { useRestoreLockedAmount } from '@/components/transactions/transaction-modal/hooks/useRestoreLockedAmount'
import { useCategoryField } from '@/components/transactions/transaction-modal/hooks/useCategoryField'
import { useMerchantField } from '@/components/transactions/transaction-modal/hooks/useMerchantField'
import { useTagField } from '@/components/transactions/transaction-modal/hooks/useTagField'
import { useAccountField } from '@/components/transactions/transaction-modal/hooks/useAccountField'
import { useDeferredTransactionRefresh } from '@/components/transactions/transaction-modal/hooks/useDeferredRefresh'
import { useTransactionDeletion } from '@/components/transactions/transaction-modal/hooks/useDeletion'
import { useTransactionSubmit } from '@/components/transactions/transaction-modal/hooks/useSubmit'
import { useTransactionShortcuts } from '@/components/transactions/transaction-modal/hooks/useShortcuts'
import { DateStepHighlightContext } from '@/components/transactions/transaction-modal/controls/dateStepHighlight'
import { ShortcutHintsVisibleContext } from '@/components/transactions/transaction-modal/controls/shortcutHintsVisible'
import RefundButton from '@/components/transactions/transaction-modal/controls/RefundButton'
import TransactionModalLinkedRefundsSection from '@/components/transactions/transaction-modal/sections/LinkedRefundsSection'
import {
  buildRefundNote,
  canLinkAsRefund,
  getRefundAccounts,
  getLinkedTransactionIds,
  isRefundable,
} from '@/components/transactions/transaction-modal/utils/refund'
import { TransactionModalIdSuffix, suffixControlIds } from '@/components/transactions/transaction-modal/ids'
import TransactionModalLinkedDeleteConfirm from '@/components/transactions/transaction-modal/modals/LinkedDeleteConfirm'

const RESTORE_FAILED_MESSAGE = 'Could not restore the bank value. Please try again.'

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
  refundOf,
  onStageRefund,
  refundRoom: refundRoomLimit,
  defaultAccountId,
  defaultCurrency,
  readOnly: readOnlyProp = false,
}: CreateTransactionModalProps) {
  const editing = !!transaction
  const refunding = !editing && !!refundOf
  const idSuffix = refunding ? '-refund' : ''
  // The refund modal keeps its form between opens, so each open remounts it to start from the expense again
  const [refundModal, setRefundModal] = useState({ open: false, key: 0 })
  const { user } = useAuth()
  const { data: accounts = [] } = useAccounts()
  const { data: categories = [] } = useCategories()
  const { data: currencies = [] } = useCurrencies()
  const linksByAccount = useBankLinksByAccount()
  const currencyState = useCurrencyListState()
  const selectableAccounts = useMemo(() => {
    const unarchived = accounts.filter((account) => !account.is_archived)
    return refundOf ? getRefundAccounts(unarchived, refundOf.currency) : unarchived
  }, [accounts, refundOf])

  // Build the initial form from the existing transaction (edit) or sensible defaults (create)
  const initialForm = useMemo<TransactionFormValues>(() => {
    return buildInitialTransactionForm({
      transaction,
      refundOf,
      refundRoom: refundRoomLimit,
      categories,
      currencies,
      selectableAccounts,
      defaultAccountId,
      defaultCurrency,
      timeZone: user?.tz,
    })
  }, [
    transaction,
    refundOf,
    refundRoomLimit,
    categories,
    currencies,
    defaultAccountId,
    defaultCurrency,
    selectableAccounts,
    user?.tz,
  ])

  const {
    form,
    setForm,
    submitError,
    setSubmitError,
    submitErrorTitle,
    setSubmitErrorTitle,
    directionHighlightKey,
    clearSubmitError,
    applyKindChange,
    handleField,
    handleAmountChange,
  } = useTransactionFormState(initialForm)

  const selectedAccount = useMemo(
    () => accounts.find((account) => account.id === form.account_id),
    [accounts, form.account_id],
  )
  const selectedCounterpartyAccount = useMemo(
    () => accounts.find((account) => account.id === form.counterparty_account_id),
    [accounts, form.counterparty_account_id],
  )
  const readOnly = editing && (readOnlyProp || Boolean(selectedAccount?.is_archived))

  // A restored bank value is already saved, so the transaction as the restore answered it is the one a
  // save compares the form with, and its bank source says which fields are still edited. The form
  // itself was built from the transaction as opened and isn't built again
  const restoreBankValue = useRestoreBankValue()
  const [restoredTransaction, setRestoredTransaction] = useState<Transaction | null>(null)
  const storedTransaction = restoredTransaction ?? transaction
  const bankSource = storedTransaction?.bank_source ?? null

  const suppliedDays = getSuppliedDays({
    form,
    transaction: storedTransaction,
    recordedAccount: selectedAccount,
    counterpartyAccount: selectedCounterpartyAccount,
    linksByAccount,
    today: getTodayYmd(user?.tz),
  })

  // Shown as soon as another account is picked, since picking one is already a finished answer
  const bankMoveRefusal = getBankMoveRefusal({
    accountId: form.account_id,
    transaction: storedTransaction,
    sourceAccount: storedTransaction && accounts.find((account) => account.id === storedTransaction.account_id),
    linksByAccount,
  })
  const { merchantModal, categoryModal, tagModal } = useTransactionReferenceCreationModals()

  const categoryField = useCategoryField({
    categories,
    readOnly,
    form,
    applyKindChange,
    clearSubmitError,
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
    clearSubmitError,
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
    clearSubmitError,
    tagById: tagField.tagById,
  })

  const currencyOptions = useMemo(() => buildCurrencyOptions(currencies, form.currency), [currencies, form.currency])
  const selectedCurrency = currencies.find((c) => c.id === form.currency)
  const selectedCurrencySymbol = selectedCurrency ? formatCurrencySymbol(selectedCurrency.id) : ''
  const knownCurrencyExponent = findCurrencyExponent(currencies, form.currency)
  const selectedCurrencyExponent = knownCurrencyExponent ?? DEFAULT_MINOR_UNIT_EXPONENT

  // Asked of this transaction's own currency rather than of the table as a whole, so a currency the
  // table does not carry keeps the field locked instead of unlocking it empty over a stored amount.
  // Editing only: an edit leaves a locked amount out of the patch, where a create would post the
  // blank it leaves behind as a zero, and a new transaction has no stored amount to lock over
  const isAmountLocked = editing && knownCurrencyExponent === null

  useRestoreLockedAmount({ open, transaction, currencies, isAmountLocked, setForm })

  const isSymmetricTransfer = isSymmetricTransferForm(form)
  const fieldLayout = getTransactionFieldLayout({ isSymmetricTransfer, direction: form.direction })

  // A refund can't give back more than is left of its expense, so the amount field says so
  const { formatCurrency } = useMoneyFormatters()
  const refundLimit =
    refunding && refundOf && refundRoomLimit !== undefined
      ? {
          minor: Math.max(refundRoomLimit, 0),
          exponent: selectedCurrencyExponent,
          message:
            refundRoomLimit > 0
              ? `Only ${formatCurrency(refundRoomLimit, refundOf.currency)} is left to refund`
              : 'This expense is already fully refunded',
        }
      : undefined
  const problems = getTransactionProblems(form, {
    editing,
    refundLimit,
    isAmountLocked,
    isBalanceAdjustmentCategory: categoryField.isBalanceAdjustmentCategory,
    selectedAccount,
    selectedCounterpartyAccount,
  })
  // A date on days a linked account's bank supplies is a problem like any other, so a press refuses it
  if (suppliedDays.message && !problems.date) problems.date = suppliedDays.message
  // So is a bank transaction moved out of its linked account, which the account field shows at once
  if (bankMoveRefusal && !problems.account_id) problems.account_id = bankMoveRefusal
  const refusal = useRefusedSubmit(problems, fieldLayout.order, suffixControlIds(fieldLayout.controlIds, idSuffix))
  const showError = (field: keyof TransactionFormFieldErrors) => refusal.errors[field]
  // The supplied-days message names a provider and a date, too long for the label row beside Date, so
  // the section shows it under the date row instead
  const suppliedDaysError =
    suppliedDays.message && showError('date') === suppliedDays.message ? suppliedDays.message : null

  const { openRef, recordCreatedAccountId, flushDeferredRefresh, closeModal } = useDeferredTransactionRefresh({
    open,
    onClose,
  })

  // The links shown and asked about on delete come from the live copy, since the transaction the modal
  // opened with is the list row as it stood then
  const liveTransaction = useTransaction(transaction?.id).data ?? transaction
  const linkedIds = liveTransaction ? getLinkedTransactionIds(liveTransaction) : []

  // Links, unlinks and refunds made in this window are held until Save and dropped on Cancel
  const pending = usePendingLinks(editing ? liveTransaction : undefined, recordCreatedAccountId)
  const refundRoom = useRefundRoom(editing ? liveTransaction : undefined, pending)

  // Delete on a linked transaction opens a dialog asking what happens to the transactions linked to it
  const [linkedDelete, setLinkedDelete] = useState({ open: false, deleteLinked: false })

  const { deleteLoading, deleteTransaction, applyPendingDeletion } = useTransactionDeletion({
    transaction,
    linkedIds,
    readOnly,
    closeModal,
    setSubmitError,
    setSubmitErrorTitle,
  })

  const { handleSubmit, submitLoading, isPending, keepOpenAfterCreate, setKeepOpenAfterCreate, runningBalance } =
    useTransactionSubmit({
      editing,
      transaction: storedTransaction,
      refundOfTransactionId: refunding ? refundOf?.id : undefined,
      stageRefund: refunding ? onStageRefund : undefined,
      refundMerchantName: merchantField.selectedMerchantOption?.label ?? null,
      pendingLinks: pending,
      form,
      setForm,
      guard: refusal.guard,
      resetRefusal: refusal.reset,
      setSubmitError,
      setSubmitErrorTitle,
      readOnly,
      accounts,
      selectedAccount,
      selectedCurrencyExponent,
      isAmountLocked,
      deleteLoading,
      openRef,
      recordCreatedAccountId,
      flushDeferredRefresh,
      closeModal,
    })

  const level = refunding ? 'stacked' : 'page'
  const { hintsVisible, dateStepHighlight } = useTransactionShortcuts(idSuffix, open, {
    date: form.date,
    steppable: !readOnly,
    onDateChange: (value) => handleField('date', value),
  })

  // Links are kept for individually owned accounts, as the server does, so a group account's
  // transactions are offered neither the Refund button nor the link pickers
  const transactionCategoryKind = transaction
    ? categoryField.categoryById.get(transaction.category_id)?.kind
    : undefined
  const canLinkHere = editing && !readOnly && !selectedAccount?.group_id
  const canOfferRefund = canLinkHere && !!transaction && isRefundable(transaction, transactionCategoryKind)

  // Asked as if the refund were not linked, since unlinking in this window frees it to be linked again
  const canLinkExpense =
    canLinkHere &&
    !!liveTransaction &&
    canLinkAsRefund({ ...liveTransaction, refund_of_transaction_id: null }, transactionCategoryKind)

  // A save and a restore each write the transaction, so neither starts while the other runs
  const restoring = restoreBankValue.isPending
  const restoringField = restoring ? restoreBankValue.variables?.field : undefined
  const bankValueCaptions = getBankValueCaptions(bankSource, storedTransaction?.currency ?? form.currency, currencies)
  const restoreField = (field: EditableBankField) => {
    if (!storedTransaction) return
    setSubmitError('')
    setSubmitErrorTitle('')
    restoreBankValue.mutate(
      { transactionId: storedTransaction.id, field },
      {
        onSuccess: (restored) => {
          setRestoredTransaction(restored)
          if (field === 'date') {
            handleField('date', restored.dt)
            return
          }
          // The field holds the amount's size and the direction its sign, so the bank's sign goes in
          // as if typed, which sets the direction to the bank's as well
          const size = amountToInputString(restored.amount, selectedCurrencyExponent)
          handleAmountChange(size, `${restored.amount < 0 ? '-' : '+'}${size}`)
        },
        onError: () => setSubmitError(RESTORE_FAILED_MESSAGE),
      },
    )
  }
  const renderBankValueCaption = (field: EditableBankField) =>
    bankSource && (
      <TransactionBankValueCaption
        id={`txn-${field}-bank-value`}
        bankValue={bankValueCaptions[field]}
        financial={field === 'amount'}
        restoring={restoringField === field}
        disabled={readOnly || isPending || restoring}
        onRestore={() => restoreField(field)}
      />
    )

  const showRunningBalance = !editing && keepOpenAfterCreate && !!selectedAccount

  // The direction toggle moves the accounts between the two fields without anything being written
  // back to the form, because the ordering is worked out here on every render
  const recordedAccountField = {
    options: accountField.accountOptions,
    selectedOption: accountField.selectedArchivedAccountOption,
    value: form.account_id,
    error: bankMoveRefusal ?? showError('account_id'),
    onChange: accountField.handleAccountChange,

    // The balance belongs to the account the transaction is recorded in, so it travels with that
    // field rather than staying under whichever dropdown happens to be on top
    runningBalance:
      showRunningBalance && selectedAccount
        ? { amount: runningBalance, currency: selectedAccount.currency }
        : undefined,
  }
  const counterpartyAccountField = {
    options: accountField.counterpartyAccountOptions,
    selectedOption: accountField.selectedArchivedCounterpartyAccountOption,
    value: form.counterparty_account_id,
    error: showError('counterparty_account_id'),
    onChange: accountField.handleCounterpartyAccountChange,
    runningBalance: undefined,
  }
  const [topAccountField, secondAccountField] = orderAccountFields(recordedAccountField, counterpartyAccountField, {
    isSymmetricTransfer,
    direction: form.direction,
  })

  return (
    <TransactionModalIdSuffix.Provider value={idSuffix}>
      <ShortcutHintsVisibleContext.Provider value={hintsVisible}>
        <DateStepHighlightContext.Provider value={dateStepHighlight}>
          <ModalTitledPanel
            open={open}
            titleId={refunding ? 'create-txn-title-refund' : 'create-txn-title'}
            level={level}
            title={editing ? 'Edit transaction' : refunding ? 'Add refund' : 'Add transaction'}
            eyebrow={
              editing
                ? 'Existing transaction'
                : refunding
                  ? buildRefundNote(refundOf?.merchant_name ?? null)
                  : `${KIND_LABELS[form.kind]} transaction`
            }
            headerStatus={readOnly ? 'Archived account' : undefined}
            headerAction={
              canOfferRefund ? (
                <RefundButton
                  onClick={() => setRefundModal((state) => ({ open: true, key: state.key + 1 }))}
                  disabledReason={
                    refundRoom === undefined || accounts.length === 0
                      ? 'Checking what is left to refund'
                      : refundRoom <= 0
                        ? 'This expense is already fully refunded'
                        : getRefundAccounts(selectableAccounts, transaction.currency).length === 0
                          ? `You have no account in ${transaction.currency} to hold this refund`
                          : null
                  }
                />
              ) : undefined
            }
            RailIcon={ReceiptText}
            railLabel="Transaction"
            extraPanelClassName={editing || refunding ? undefined : 'min-h-(--app-transaction-window-height)'}
            onClose={closeModal}
            onExitComplete={() => {
              applyPendingDeletion()
              pending.reset()
            }}
            onSubmit={handleSubmit}
            footer={
              <TransactionModalFooter
                level={level}
                hideKeepOpen={refunding}
                addLabel={refunding ? 'Add refund' : 'Add transaction'}
                onRequestLinkedDelete={
                  linkedIds.length > 0 ? () => setLinkedDelete({ open: true, deleteLinked: false }) : null
                }
                editing={editing}
                isPending={isPending || restoring}
                readOnly={readOnly}
                submitLoading={submitLoading}
                submitBlockedReason={refusal.blockedReason}
                deleteLoading={deleteLoading}
                keepOpenAfterCreate={keepOpenAfterCreate}
                onKeepOpenAfterCreateChange={setKeepOpenAfterCreate}
                onCancel={closeModal}
                onDelete={deleteTransaction}
              />
            }
          >
            <div className="space-y-5">
              {bankSource && (
                <TransactionBankSourcePanel
                  providerName={bankSource.provider_name}
                  description={bankSource.bank_values.description}
                />
              )}

              <TransactionTypeDirectionSection
                kind={form.kind}
                direction={form.direction}
                editing={editing}
                refunding={refunding}
                readOnly={readOnly}
                directionHighlightKey={directionHighlightKey}
                onKindChange={applyKindChange}
                onDirectionChange={(value) => handleField('direction', value)}
              />

              <TransactionReferencesSection
                accountOptions={topAccountField.options}
                selectedArchivedAccountOption={topAccountField.selectedOption}
                accountValue={topAccountField.value}
                accountError={topAccountField.error}
                accountPlaceholder={accounts.length === 0 ? 'No accounts yet' : 'Select account...'}
                runningBalance={topAccountField.runningBalance}
                kind={form.kind}

                direction={form.direction}
                isSymmetricTransfer={form.symmetric_transfer}
                isTransferPairOffered={!editing}
                counterpartyAccountOptions={secondAccountField.options}
                selectedArchivedCounterpartyAccountOption={secondAccountField.selectedOption}
                counterpartyAccountValue={secondAccountField.value}
                counterpartyAccountError={secondAccountField.error}
                counterpartyAccountRunningBalance={secondAccountField.runningBalance}
                merchantOptions={merchantField.merchantOptions}
                selectedMerchantOption={merchantField.selectedMerchantOption}
                merchantValue={form.merchant_id}
                merchantError={showError('merchant_id')}
                merchantSearch={merchantField.search}
                merchantSearchSettled={merchantField.searchSettled}
                merchantLoading={merchantField.showLoading}
                merchantLoadingText={merchantField.loadingText}
                merchantHideOptionsWhileLoading={merchantField.showInitialLoading}
                merchantHasMore={merchantField.hasMore}
                categoryOptions={categoryField.categoryOptions}
                categoryValue={form.category_id}
                categoryError={showError('category_id')}
                isBalanceAdjustmentCategory={categoryField.isBalanceAdjustmentCategory}
                creditRepaymentSteer={categoryField.creditRepaymentSteer}
                showMerchantDefaultCategoryAction={merchantField.showMerchantDefaultCategoryAction}
                merchantDefaultCategoryActionLabel={merchantField.merchantDefaultCategoryActionLabel}
                merchantDefaultCategoryPending={merchantField.merchantDefaultCategoryPending}
                tagOptions={tagField.tagOptions}
                tagsDisabled={!form.account_id}
                tagSearch={tagField.search}
                tagSearchSettled={tagField.searchSettled}
                tagLoading={tagField.showLoading}
                tagLoadingText={tagField.loadingText}
                tagHideOptionsWhileLoading={tagField.showInitialLoading}
                tagHasMore={tagField.hasMore}
                selectedTags={tagField.selectedTags}
                readOnly={readOnly}
                onAccountChange={topAccountField.onChange}
                onSymmetricTransferChange={accountField.handleSymmetricTransferChange}
                onCounterpartyAccountChange={secondAccountField.onChange}
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
                dateError={suppliedDaysError ? undefined : showError('date')}
                suppliedDaysError={suppliedDaysError}
                isDateDisabled={suppliedDays.isDateDisabled}
                currencyOptions={currencyOptions}
                currencyValue={form.currency}
                currencyPlaceholder={currencyState === 'loading' ? CURRENCY_LIST_LOADING : 'Select...'}
                selectedCurrencySymbol={selectedCurrencySymbol}
                currencyExponent={selectedCurrencyExponent}
                isAmountLocked={isAmountLocked}
                currencyState={currencyState}
                amount={form.amount}
                amountError={showError('amount')}
                notes={form.notes}
                readOnly={readOnly}
                onDateChange={(value) => handleField('date', value)}
                onDateBlur={() => refusal.touch('date')}
                onAmountChange={handleAmountChange}
                onAmountBlur={() => refusal.touch('amount')}
                onNotesChange={(value) => handleField('notes', value)}
                dateCaption={renderBankValueCaption('date')}
                amountCaption={renderBankValueCaption('amount')}
              />

              {liveTransaction && (
                <TransactionModalLinkedRefundsSection
                  transaction={liveTransaction}
                  readOnly={readOnly}
                  disabled={isPending}
                  canLinkRefund={canOfferRefund}
                  canLinkExpense={canLinkExpense}
                  pending={pending}
                  refundRoom={refundRoom}
                />
              )}

              <FormError message={submitError} title={submitErrorTitle} />
            </div>
          </ModalTitledPanel>
        </DateStepHighlightContext.Provider>
      </ShortcutHintsVisibleContext.Provider>
      <TransactionModalLinkedDeleteConfirm
        open={open && linkedDelete.open}
        linkedCount={linkedIds.length}
        deleteLinked={linkedDelete.deleteLinked}
        onDeleteLinkedChange={(deleteLinked) => setLinkedDelete((state) => ({ ...state, deleteLinked }))}
        error={submitError || null}
        isDeleting={deleteLoading}
        onConfirm={() => {
          void deleteTransaction(linkedDelete.deleteLinked).then((deleted) => {
            if (deleted) setLinkedDelete((state) => ({ ...state, open: false }))
          })
        }}
        onCancel={() => {
          setSubmitError('')
          setSubmitErrorTitle('')
          setLinkedDelete((state) => ({ ...state, open: false }))
        }}
      />
      {canOfferRefund && transaction && (
        <CreateTransactionModal
          key={refundModal.key}
          open={open && refundModal.open}
          onClose={() => setRefundModal((state) => ({ ...state, open: false }))}
          refundOf={transaction}
          onStageRefund={pending.addRefund}
          refundRoom={refundRoom}
        />
      )}
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
    </TransactionModalIdSuffix.Provider>
  )
}
