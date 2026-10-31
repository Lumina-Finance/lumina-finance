import { useCallback, useRef, useState } from 'react'
import {
  useCreateTransaction,
  useLinkRefund,
  useRefreshCreatedTransactions,
  useUnlinkRefund,
  type CreateTransactionPayload,
  type Transaction,
} from '@/api/transactions'

/** A refund the edit window will create when it is saved, with what the Refunds section shows of it */
export interface PendingRefund {
  key: string
  payload: CreateTransactionPayload
  preview: Pick<Transaction, 'merchant_name' | 'dt' | 'amount' | 'currency'>
}

interface PendingLinksState {
  /** Existing transactions to link on save: the refunds of an expense, or the one expense of a refund */
  links: Transaction[]

  /** Refunds whose saved link is removed on save */
  unlinkedRefundIds: string[]

  /** Refunds whose link Save has removed. They stay out of the sections until the window closes, so a row that
   * went does not come back while the transaction reloads */
  appliedUnlinkIds: string[]
  refunds: PendingRefund[]

  /** Links and created refunds that Save has made. They stay shown as rows, in the place they held, until the window
   * closes, so the section does not shrink while the saved copy loads. A created refund carries its new id */
  appliedLinks: Transaction[]
  appliedRefunds: (PendingRefund & { id: string })[]
}

const NOTHING_PENDING: PendingLinksState = {
  links: [],
  unlinkedRefundIds: [],
  appliedUnlinkIds: [],
  refunds: [],
  appliedLinks: [],
  appliedRefunds: [],
}

export interface PendingLinks extends PendingLinksState {
  /** How many changes are held back until Save */
  count: number
  addLink: (transaction: Transaction) => void
  removeLink: (transactionId: string) => void
  unlink: (refundId: string) => void
  addRefund: (refund: PendingRefund) => void
  removeRefund: (key: string) => void
  reset: () => void

  /** Removes the saved links that were unlinked, before the edit is saved, so their room is free */
  applyUnlinks: () => Promise<void>

  /** Makes the picked links and creates the new refunds, once the edit is saved */
  applyAdditions: () => Promise<void>

  /** How many changes this save has made so far, which is what a save that stopped partway leaves saved */
  appliedCount: () => number

  /** Starts counting the changes of a new save from none */
  startSave: () => void

  /** Refreshes what the screen shows of the changes already made, so it matches the server after a failure */
  refreshApplied: () => void
}

/**
 * Holds the link changes made in an edit window until Save: picks from the picker, unlinks, and
 * refunds still to be created. Cancelling or closing drops them, and each one is forgotten as soon as
 * it is applied, so a save that fails partway repeats none of what already went through
 *
 * @param anchor The transaction the window edits, whose side of each link decides who is the refund
 * @param recordCreatedAccountId Remembers an account a created refund touched, so it refreshes on close
 */
export function usePendingLinks(
  anchor: Transaction | undefined,
  recordCreatedAccountId: (accountId: string) => void,
): PendingLinks {
  const [state, setState] = useState(NOTHING_PENDING)
  const linkMutation = useLinkRefund()
  const unlinkMutation = useUnlinkRefund()
  const createMutation = useCreateTransaction({ deferAccountInvalidation: true, deferTransactionInvalidation: true })
  const refreshCreatedTransactions = useRefreshCreatedTransactions()
  const applied = useRef({ count: 0, accountIds: [] as string[] })

  // Picking again the transaction whose saved link is held for removal cancels that removal, as nothing has changed
  const addLink = useCallback(
    (transaction: Transaction) =>
      setState((current) => {
        const heldUnlinkId = anchor?.refund_of_transaction_id === transaction.id ? anchor.id : transaction.id
        if (current.unlinkedRefundIds.includes(heldUnlinkId)) {
          return { ...current, unlinkedRefundIds: current.unlinkedRefundIds.filter((id) => id !== heldUnlinkId) }
        }
        return { ...current, links: [...current.links.filter((l) => l.id !== transaction.id), transaction] }
      }),
    [anchor],
  )
  const removeLink = useCallback(
    (transactionId: string) =>
      setState((current) => ({ ...current, links: current.links.filter((link) => link.id !== transactionId) })),
    [],
  )
  const unlink = useCallback(
    (refundId: string) =>
      setState((current) => ({ ...current, unlinkedRefundIds: [...current.unlinkedRefundIds, refundId] })),
    [],
  )
  const addRefund = useCallback(
    (refund: PendingRefund) => setState((current) => ({ ...current, refunds: [...current.refunds, refund] })),
    [],
  )
  const removeRefund = useCallback(
    (key: string) => setState((current) => ({ ...current, refunds: current.refunds.filter((r) => r.key !== key) })),
    [],
  )
  const reset = useCallback(() => setState(NOTHING_PENDING), [])

  const applyUnlinks = async () => {
    for (const refundId of state.unlinkedRefundIds) {
      await unlinkMutation.mutateAsync(refundId)
      applied.current.count += 1
      setState((current) => ({
        ...current,
        unlinkedRefundIds: current.unlinkedRefundIds.filter((id) => id !== refundId),
        appliedUnlinkIds: [...current.appliedUnlinkIds, refundId],

        // A link this window made and has now removed. A refund's only link is the one it just lost
        appliedLinks: current.appliedLinks.filter((link) => link.id !== refundId && anchor?.id !== refundId),
      }))
    }
  }

  const applyAdditions = async () => {
    if (!anchor) return

    // An expense is linked to the refunds picked for it, and a refund to the one expense picked for it
    const anchorIsExpense = anchor.amount < 0
    for (const picked of state.links) {
      const [refundId, originalId] = anchorIsExpense ? [picked.id, anchor.id] : [anchor.id, picked.id]
      await linkMutation.mutateAsync({ refundId, originalId })
      applied.current.count += 1
      setState((current) => ({
        ...current,
        links: current.links.filter((link) => link.id !== picked.id),
        appliedLinks: [...current.appliedLinks, picked],

        // The refund is linked again, so an earlier removal of its link no longer takes its row away
        appliedUnlinkIds: current.appliedUnlinkIds.filter((id) => id !== refundId),
      }))
    }
    for (const refund of state.refunds) {
      const created = await createMutation.mutateAsync({ ...refund.payload, refund_of_transaction_id: anchor.id })
      recordCreatedAccountId(created.account_id)
      applied.current.count += 1
      applied.current.accountIds.push(created.account_id)
      setState((current) => ({
        ...current,
        refunds: current.refunds.filter((r) => r.key !== refund.key),
        appliedRefunds: [...current.appliedRefunds, { ...refund, id: created.id }],
      }))
    }
  }

  return {
    ...state,
    count: state.links.length + state.unlinkedRefundIds.length + state.refunds.length,
    addLink,
    removeLink,
    unlink,
    addRefund,
    removeRefund,
    reset,
    applyUnlinks,
    applyAdditions,
    appliedCount: () => applied.current.count,
    startSave: () => {
      applied.current = { count: 0, accountIds: [] }
    },
    refreshApplied: () => refreshCreatedTransactions(applied.current.accountIds),
  }
}
