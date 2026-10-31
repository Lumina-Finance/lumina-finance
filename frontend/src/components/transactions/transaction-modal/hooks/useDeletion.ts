import { useCallback, useRef, type Dispatch, type SetStateAction } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { ApiError } from '@/api/auth'
import {
  applyBulkTransactionDeletion,
  useBulkDeleteTransactions,
  useDeleteTransaction,
  type Transaction,
} from '@/api/transactions'
import { MIN_DELETE_TRANSACTION_LOADING_MS } from '@/components/transactions/transaction-modal/constants'

interface UseTransactionDeletionOptions {
  transaction?: Transaction

  /** The transactions linked to the open one, which deleting with its linked ones takes too */
  linkedIds: string[]
  readOnly: boolean
  closeModal: () => void
  setSubmitError: Dispatch<SetStateAction<string>>
  setSubmitErrorTitle: Dispatch<SetStateAction<string>>
}

interface TransactionDeletionState {
  deleteLoading: boolean

  /** Deletes the open transaction, and the transactions linked to it when deleteLinked is set */
  deleteTransaction: (deleteLinked?: boolean) => Promise<boolean>
  applyPendingDeletion: () => void
}

/**
 * Deletes the open transaction and holds its row in the cache until the modal has left the
 * screen, so the deferred removal can animate the row out in view rather than behind the closing
 * modal
 */
export function useTransactionDeletion({
  transaction,
  linkedIds,
  readOnly,
  closeModal,
  setSubmitError,
  setSubmitErrorTitle,
}: UseTransactionDeletionOptions): TransactionDeletionState {
  const queryClient = useQueryClient()
  const deleteMutation = useDeleteTransaction({
    minimumPendingMs: MIN_DELETE_TRANSACTION_LOADING_MS,
    deferRemoval: true,
  })
  const bulkDeleteMutation = useBulkDeleteTransactions({
    minimumPendingMs: MIN_DELETE_TRANSACTION_LOADING_MS,
    deferRemoval: true,
  })

  // Holds a completed deletion until the modal has left so its row collapses in view rather than behind
  // the closing modal
  const pendingDeletionRef = useRef<{ ids: string[]; accountIds: string[] } | null>(null)

  const deleteLoading = deleteMutation.isPending || bulkDeleteMutation.isPending

  const deleteTransaction = async (deleteLinked = false) => {
    if (!transaction || readOnly) return false

    setSubmitError('')
    setSubmitErrorTitle('')

    try {
      // Deleting the linked ones too is the bulk delete choosing them, which also says which accounts
      // the linked ones were in
      if (deleteLinked && linkedIds.length > 0) {
        const result = await bulkDeleteMutation.mutateAsync({
          transactionIds: [transaction.id],
          linkedIds,
        })
        pendingDeletionRef.current = { ids: [transaction.id, ...linkedIds], accountIds: result.affected_account_ids }
      } else {
        await deleteMutation.mutateAsync(transaction.id)
        pendingDeletionRef.current = { ids: [transaction.id], accountIds: [transaction.account_id] }
      }
      closeModal()
      return true
    } catch (err) {
      setSubmitError(err instanceof ApiError ? err.message : 'Could not delete transaction.')
      return false
    }
  }

  // Runs after the modal exit animation, so a deferred deletion clears its row once the modal is gone
  const applyPendingDeletion = useCallback(() => {
    const pending = pendingDeletionRef.current
    if (!pending) return

    pendingDeletionRef.current = null
    applyBulkTransactionDeletion(queryClient, pending.ids, pending.accountIds)
  }, [queryClient])

  return { deleteLoading, deleteTransaction, applyPendingDeletion }
}
