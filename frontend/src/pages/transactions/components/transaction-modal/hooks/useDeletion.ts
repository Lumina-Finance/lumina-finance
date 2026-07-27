import { useCallback, useRef, type Dispatch, type SetStateAction } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { ApiError } from '@/api/auth'
import {
  applyTransactionDeletion,
  useDeleteTransaction,
  type Transaction,
} from '@/api/transactions'
import { MIN_DELETE_TRANSACTION_LOADING_MS } from '@/pages/transactions/components/transaction-modal/constants'

interface UseTransactionDeletionOptions {
  transaction?: Transaction
  readOnly: boolean
  closeModal: () => void
  setSubmitError: Dispatch<SetStateAction<string>>
  setSubmitErrorTitle: Dispatch<SetStateAction<string>>
}

interface TransactionDeletionState {
  deleteLoading: boolean
  deleteTransaction: () => Promise<boolean>
  applyPendingDeletion: () => void
}

/**
 * Deletes the open transaction and holds its row in the cache until the modal has left the
 * screen, so the deferred removal can animate the row out in view rather than behind the closing
 * modal
 */
export function useTransactionDeletion({
  transaction,
  readOnly,
  closeModal,
  setSubmitError,
  setSubmitErrorTitle,
}: UseTransactionDeletionOptions): TransactionDeletionState {
  const queryClient = useQueryClient()
  const deleteMutation = useDeleteTransaction({ minimumPendingMs: MIN_DELETE_TRANSACTION_LOADING_MS, deferRemoval: true })

  // Holds a completed deletion until the modal has left so its row collapses in view rather than behind
  // the closing modal
  const pendingDeletionRef = useRef<{ id: string; accountId: string } | null>(null)

  const deleteLoading = deleteMutation.isPending

  const deleteTransaction = async () => {
    if (!transaction || readOnly) return false

    setSubmitError('')
    setSubmitErrorTitle('')

    try {
      await deleteMutation.mutateAsync(transaction.id)
      pendingDeletionRef.current = { id: transaction.id, accountId: transaction.account_id }
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
    applyTransactionDeletion(queryClient, pending.id, pending.accountId)
  }, [queryClient])

  return { deleteLoading, deleteTransaction, applyPendingDeletion }
}
