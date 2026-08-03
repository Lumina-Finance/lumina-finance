import { useState, type Dispatch, type FormEvent, type MutableRefObject, type SetStateAction } from 'react'
import type { AccountsOverview } from '@/api/accounts'
import { ApiError } from '@/api/auth'
import {
  useCreateTransaction,
  useUpdateTransaction,
  type Transaction,
} from '@/api/transactions'
import { waitForMilliseconds } from '@/utils/timing'
import {
  INITIAL_TRANSACTION_FORM,
  MIN_ADD_TRANSACTION_LOADING_MS,
  MIN_BATCH_ADD_TRANSACTION_LOADING_MS,
} from '@/pages/transactions/components/transaction-modal/constants'
import {
  buildCreateTransactionPayload,
  buildSymmetricTransferPayloads,
  getSymmetricTransferLegKinds,
  buildUpdateTransactionPatch,
} from '@/pages/transactions/components/transaction-modal/utils/payloads'
import {
  getSymmetricTransferAccountError,
  isSymmetricTransferForm,
  validateTransactionForm,
} from '@/pages/transactions/components/transaction-modal/utils/validation'
import type {
  TransactionFormFieldErrors,
  TransactionFormValues,
} from '@/pages/transactions/components/transaction-modal/types'

interface UseTransactionSubmitOptions {
  editing: boolean
  transaction?: Transaction
  form: TransactionFormValues
  setForm: Dispatch<SetStateAction<TransactionFormValues>>
  setFieldErrors: Dispatch<SetStateAction<TransactionFormFieldErrors>>
  setTouched: Dispatch<SetStateAction<Record<string, boolean>>>
  setSubmitError: Dispatch<SetStateAction<string>>
  setSubmitErrorTitle: Dispatch<SetStateAction<string>>
  readOnly: boolean
  accounts: AccountsOverview[]
  selectedAccount: AccountsOverview | undefined
  selectedCounterpartyAccount: AccountsOverview | undefined
  selectedCurrencyExponent: number
  isAmountLocked: boolean
  isBalanceAdjustmentCategory: boolean
  deleteLoading: boolean
  openRef: MutableRefObject<boolean>
  recordCreatedAccountId: (accountId: string) => void
  flushDeferredRefresh: () => void
  closeModal: () => void
}

interface TransactionSubmitState {
  handleSubmit: (e: FormEvent) => Promise<void>
  submitLoading: boolean
  isPending: boolean
  keepOpenAfterCreate: boolean
  setKeepOpenAfterCreate: Dispatch<SetStateAction<boolean>>
  runningBalance: number
}

/**
 * Owns transaction create, update, and the keep-open batch flow, including the running balance
 * shown while a batch of creates targets the same account
 */
export function useTransactionSubmit({
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
  selectedCounterpartyAccount,
  selectedCurrencyExponent,
  isAmountLocked,
  isBalanceAdjustmentCategory,
  deleteLoading,
  openRef,
  recordCreatedAccountId,
  flushDeferredRefresh,
  closeModal,
}: UseTransactionSubmitOptions): TransactionSubmitState {
  const createMutation = useCreateTransaction({ deferAccountInvalidation: true, deferTransactionInvalidation: true })
  const updateMutation = useUpdateTransaction()
  const [keepOpenAfterCreate, setKeepOpenAfterCreate] = useState(false)
  const [sessionAccountDeltas, setSessionAccountDeltas] = useState<Record<string, number>>({})
  const [createDelayPending, setCreateDelayPending] = useState(false)

  const createLoading = createMutation.isPending || createDelayPending
  const submitLoading = editing ? updateMutation.isPending : createLoading
  const isPending = createLoading || updateMutation.isPending || deleteLoading

  const selectedAccountSessionDelta = selectedAccount ? (sessionAccountDeltas[selectedAccount.id] ?? 0) : 0
  const runningBalance = selectedAccount
    ? selectedAccount.current_balance + selectedAccountSessionDelta
    : 0

  // Resets the form after a create so a keep-open batch starts its next row from the same
  // account, category, merchant, currency, and date instead of blank fields
  //
  // The recorded counterparty account is kept on every path, because it is required on every
  // transfer create and a batch of them would otherwise have to answer it again on each row.
  // Outside a transfer the field is off-screen and empty, so keeping it changes nothing
  //
  // A symmetric transfer additionally keeps symmetric_transfer, because dropping it would force
  // re-arming the checkbox before every row of a batch
  const resetFormAfterCreate = ({ keepTransferPair }: { keepTransferPair: boolean }) => {
    setForm({
      ...INITIAL_TRANSACTION_FORM,
      kind: form.kind,
      direction: form.direction,
      account_id: form.account_id,
      category_id: form.category_id,
      merchant_id: form.merchant_id,
      currency: form.currency,
      date: form.date,
      counterparty_account_id: form.counterparty_account_id,
      ...(keepTransferPair ? { symmetric_transfer: form.symmetric_transfer } : {}),
    })
    setFieldErrors({})
    setTouched({})
    setSubmitError('')
    setSubmitErrorTitle('')
  }

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (isPending || readOnly) return
    const errors = validateTransactionForm(form, { isAmountLocked, isBalanceAdjustmentCategory })
    // Ticking the checkbox creates a real transaction in the recorded account, so that account has
    // to be one the amount is valid in. Both accounts have to be loaded to compare them
    if (!editing && isSymmetricTransferForm(form) && !errors.counterparty_account_id) {
      const accountError = getSymmetricTransferAccountError(selectedAccount, selectedCounterpartyAccount)
      if (accountError) errors.counterparty_account_id = accountError
    }
    setFieldErrors(errors)
    setTouched({
      account_id: true,
      category_id: true,
      merchant_id: true,
      amount: true,
      currency: true,
      date: true,
      counterparty_account_id: true,
    })
    if (Object.keys(errors).length > 0) return

    if (editing && transaction) {
      const patch = buildUpdateTransactionPatch(
        form,
        transaction,
        isAmountLocked ? null : selectedCurrencyExponent,
      )

      if (!patch) {
        closeModal()
        return
      }

      updateMutation.mutate(
        { id: transaction.id, patch },
        {
          onSuccess: () => closeModal(),
          onError: (err) => {
            setSubmitError(err instanceof ApiError ? err.message : 'Something went wrong. Please try again.')
          },
        },
      )
      return
    }

    if (isSymmetricTransferForm(form)) {
      const [fromPayload, toPayload] = buildSymmetricTransferPayloads(form, selectedCurrencyExponent)
      const [recordedLegKind, otherLegKind] = getSymmetricTransferLegKinds(form.direction)
      const legs = [
        { failedKind: recordedLegKind, accountId: form.account_id, payload: fromPayload },
        { failedKind: otherLegKind, accountId: form.counterparty_account_id, payload: toPayload },
      ]

      setSubmitError('')
      setSubmitErrorTitle('')
      setCreateDelayPending(true)
      const minimumLoading = waitForMilliseconds(
        keepOpenAfterCreate ? MIN_BATCH_ADD_TRANSACTION_LOADING_MS : MIN_ADD_TRANSACTION_LOADING_MS,
      )

      // Each leg is independent, so a failed leg leaves the other in place rather than rolling back
      const results = await Promise.allSettled(legs.map((leg) => createMutation.mutateAsync(leg.payload)))
      const created: Transaction[] = []
      const failedLegs: typeof legs = []
      results.forEach((result, index) => {
        if (result.status === 'fulfilled') created.push(result.value)
        else failedLegs.push(legs[index])
      })

      created.forEach((txn) => recordCreatedAccountId(txn.account_id))
      if (created.length > 0) {
        setSessionAccountDeltas((deltas) => {
          const next = { ...deltas }
          created.forEach((txn) => {
            next[txn.account_id] = (next[txn.account_id] ?? 0) + txn.amount
          })
          return next
        })
      }

      await minimumLoading
      setCreateDelayPending(false)

      if (!openRef.current) {
        flushDeferredRefresh()
        return
      }

      if (failedLegs.length === legs.length) {
        setSubmitError('Something went wrong. Please try again.')
        return
      }

      if (failedLegs.length === 1) {
        const failedLeg = failedLegs[0]
        const accountName = accounts.find((account) => account.id === failedLeg.accountId)?.name ?? 'the counterparty account'
        setSubmitErrorTitle('One of the pair of transactions failed.')
        setSubmitError(`There was a problem creating a ${failedLeg.failedKind} transfer in ${accountName}. Please add that leg manually.`)
        return
      }

      if (!keepOpenAfterCreate) {
        closeModal()
        return
      }

      resetFormAfterCreate({ keepTransferPair: true })
      return
    }

    const payload = buildCreateTransactionPayload(form, selectedCurrencyExponent)

    setSubmitError('')
    setSubmitErrorTitle('')
    setCreateDelayPending(true)
    const minimumLoading = waitForMilliseconds(
      keepOpenAfterCreate ? MIN_BATCH_ADD_TRANSACTION_LOADING_MS : MIN_ADD_TRANSACTION_LOADING_MS,
    )

    try {
      const createdTransaction = await createMutation.mutateAsync(payload)
      recordCreatedAccountId(createdTransaction.account_id)
      setSessionAccountDeltas((deltas) => ({
        ...deltas,
        [createdTransaction.account_id]: (deltas[createdTransaction.account_id] ?? 0) + createdTransaction.amount,
      }))
      if (!openRef.current) {
        flushDeferredRefresh()
        return
      }
      await minimumLoading

      if (!keepOpenAfterCreate) {
        closeModal()
        return
      }

      resetFormAfterCreate({ keepTransferPair: false })
    } catch (err) {
      await minimumLoading
      setSubmitError(err instanceof ApiError ? err.message : 'Something went wrong. Please try again.')
    } finally {
      setCreateDelayPending(false)
    }
  }

  return {
    handleSubmit,
    submitLoading,
    isPending,
    keepOpenAfterCreate,
    setKeepOpenAfterCreate,
    runningBalance,
  }
}
