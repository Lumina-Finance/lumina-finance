import { useState, type Dispatch, type FormEvent, type MutableRefObject, type SetStateAction } from 'react'
import type { AccountsOverview } from '@/api/accounts'
import { ApiError } from '@/api/auth'
import { useCreateTransaction, useUpdateTransaction, type Transaction } from '@/api/transactions'
import { getCreateFailureMessage, getTransferFailureNotice } from '@/utils/createFailure'
import { createRandomId } from '@/utils/randomId'
import { LOADING_ANIMATION_MIN_MS, waitForMilliseconds } from '@/utils/timing'
import {
  INITIAL_TRANSACTION_FORM,
  MIN_ADD_TRANSACTION_LOADING_MS,
  MIN_BATCH_ADD_TRANSACTION_LOADING_MS,
} from '@/components/transactions/transaction-modal/constants'
import {
  buildCreateTransactionPayload,
  buildSymmetricTransferPayloads,
  getSymmetricTransferLegKinds,
  buildUpdateTransactionPatch,
} from '@/components/transactions/transaction-modal/utils/payloads'
import { isSymmetricTransferForm } from '@/components/transactions/transaction-modal/utils/validation'
import type { TransactionFormValues } from '@/components/transactions/transaction-modal/types'
import type { PendingLinks, PendingRefund } from '@/components/transactions/transaction-modal/hooks/usePendingLinks'

interface UseTransactionSubmitOptions {
  editing: boolean
  transaction?: Transaction

  /** The expense a new transaction refunds, saved as the link in the same request */
  refundOfTransactionId?: string

  /** Hands a refund to the edit window it was made from, which creates it on its own Save */
  stageRefund?: (refund: PendingRefund) => void
  refundMerchantName: string | null

  /** The link changes the edit window holds until Save */
  pendingLinks: PendingLinks
  form: TransactionFormValues
  setForm: Dispatch<SetStateAction<TransactionFormValues>>

  // Marks the form's problems and returns false while it has any, from the refused-press hook
  guard: () => boolean

  // Takes the marks off a form a keep-open batch has just cleared for its next row
  resetRefusal: () => void
  setSubmitError: Dispatch<SetStateAction<string>>
  setSubmitErrorTitle: Dispatch<SetStateAction<string>>
  readOnly: boolean
  accounts: AccountsOverview[]
  selectedAccount: AccountsOverview | undefined
  selectedCurrencyExponent: number
  isAmountLocked: boolean
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
  refundOfTransactionId,
  stageRefund,
  refundMerchantName,
  pendingLinks,
  form,
  setForm,
  guard,
  resetRefusal,
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
}: UseTransactionSubmitOptions): TransactionSubmitState {
  const createMutation = useCreateTransaction({ deferAccountInvalidation: true, deferTransactionInvalidation: true })
  const updateMutation = useUpdateTransaction({ minimumPendingMs: LOADING_ANIMATION_MIN_MS })
  const [keepOpenAfterCreate, setKeepOpenAfterCreate] = useState(false)
  const [sessionAccountDeltas, setSessionAccountDeltas] = useState<Record<string, number>>({})
  const [createDelayPending, setCreateDelayPending] = useState(false)

  const [editSaving, setEditSaving] = useState(false)

  const createLoading = createMutation.isPending || createDelayPending
  const submitLoading = editing ? updateMutation.isPending || editSaving : createLoading
  const isPending = createLoading || updateMutation.isPending || editSaving || deleteLoading

  const selectedAccountSessionDelta = selectedAccount ? (sessionAccountDeltas[selectedAccount.id] ?? 0) : 0
  const runningBalance = selectedAccount ? selectedAccount.current_balance + selectedAccountSessionDelta : 0

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
    resetRefusal()
    setSubmitError('')
    setSubmitErrorTitle('')
  }

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (isPending || readOnly || !guard()) return

    if (editing && transaction) {
      const patch = buildUpdateTransactionPatch(form, transaction, isAmountLocked ? null : selectedCurrencyExponent)

      if (!patch && pendingLinks.count === 0) {
        closeModal()
        return
      }

      // Link changes made in the window are held until here. Unlinking comes first, so the room it frees
      // is there for a new link, and the edit comes before any link that depends on it
      setSubmitError('')
      setSubmitErrorTitle('')
      setEditSaving(true)
      const minimumLoading = waitForMilliseconds(LOADING_ANIMATION_MIN_MS)
      pendingLinks.startSave()
      let patchSaved = false
      try {
        await pendingLinks.applyUnlinks()
        if (patch) {
          await updateMutation.mutateAsync({ id: transaction.id, patch })
          patchSaved = true
        }
        await pendingLinks.applyAdditions()
        await minimumLoading
        closeModal()
      } catch (err) {
        await minimumLoading
        const reason = err instanceof ApiError ? err.message : 'Something went wrong. Please try again.'

        // What already went through stays, so the window says so and shows it as the server has it
        const savedSome = patchSaved || pendingLinks.appliedCount() > 0
        if (savedSome) pendingLinks.refreshApplied()
        setSubmitError(savedSome ? `Some changes were saved, but not all. ${reason}` : reason)
      } finally {
        setEditSaving(false)
      }
      return
    }

    // A refund made from an edit window is held by that window and created when it is saved
    if (stageRefund && refundOfTransactionId) {
      const payload = buildCreateTransactionPayload(form, selectedCurrencyExponent, refundOfTransactionId)
      stageRefund({
        key: createRandomId(),
        payload,
        preview: {
          merchant_name: refundMerchantName,
          dt: payload.dt,
          amount: payload.amount,
          currency: payload.currency,
        },
      })
      closeModal()
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
      const failedLegs: { leg: (typeof legs)[number]; reason: unknown }[] = []
      results.forEach((result, index) => {
        if (result.status === 'fulfilled') created.push(result.value)
        else failedLegs.push({ leg: legs[index], reason: result.reason })
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

      if (failedLegs.length > 0) {
        const notice = getTransferFailureNotice(
          failedLegs.map(({ leg, reason }) => {
            const accountName =
              accounts.find((account) => account.id === leg.accountId)?.name ?? 'the counterparty account'
            return { description: `a ${leg.failedKind} transfer in ${accountName}`, reason }
          }),
          legs.length,
        )
        setSubmitErrorTitle(notice.title)
        setSubmitError(notice.message)
        return
      }

      if (!keepOpenAfterCreate) {
        closeModal()
        return
      }

      resetFormAfterCreate({ keepTransferPair: true })
      return
    }

    const payload = buildCreateTransactionPayload(form, selectedCurrencyExponent, refundOfTransactionId)

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
      setSubmitError(getCreateFailureMessage(err, 'transaction'))
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
