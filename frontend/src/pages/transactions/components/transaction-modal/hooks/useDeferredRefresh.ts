import { useCallback, useEffect, useRef, type MutableRefObject } from 'react'
import { useRefreshCreatedTransactions } from '@/api/transactions'

interface UseDeferredTransactionRefreshOptions {
  open: boolean
  onClose: () => void
}

interface DeferredTransactionRefreshState {
  openRef: MutableRefObject<boolean>
  recordCreatedAccountId: (accountId: string) => void
  flushDeferredRefresh: () => void
  closeModal: () => void
}

/**
 * Defers the transactions-page and account refresh for a session of one or more creates until the
 * modal closes, so it refreshes once, on dismiss, instead of refetching behind the open modal
 * after every save
 */
export function useDeferredTransactionRefresh({
  open,
  onClose,
}: UseDeferredTransactionRefreshOptions): DeferredTransactionRefreshState {
  const refreshCreatedTransactions = useRefreshCreatedTransactions()
  const createdAccountIdsRef = useRef<Set<string>>(new Set())
  const openRef = useRef(open)

  // Runs on close so a session of one or more creates refreshes the transactions page once, on
  // dismiss, rather than refetching the list and overview behind the open modal after every save
  const flushDeferredRefresh = useCallback(() => {
    const accountIds = [...createdAccountIdsRef.current]
    if (accountIds.length === 0) return

    createdAccountIdsRef.current.clear()
    refreshCreatedTransactions(accountIds)
  }, [refreshCreatedTransactions])

  const closeModal = useCallback(() => {
    onClose()
    window.setTimeout(flushDeferredRefresh, 0)
  }, [flushDeferredRefresh, onClose])

  useEffect(() => {
    openRef.current = open
    if (open) return
    flushDeferredRefresh()
  }, [flushDeferredRefresh, open])

  const recordCreatedAccountId = (accountId: string) => {
    createdAccountIdsRef.current.add(accountId)
  }

  return { openRef, recordCreatedAccountId, flushDeferredRefresh, closeModal }
}
