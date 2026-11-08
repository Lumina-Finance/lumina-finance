import { MODAL_INSET_CLASS_NAME } from '@/components/modal/inset'
import { ReviewDecisionButton } from '@/components/transactions/bank-review/DecisionButton'
import ShortcutHint from '@/components/transactions/transaction-modal/controls/ShortcutHint'
import ShortcutHints from '@/components/transactions/transaction-modal/controls/ShortcutHints'
import TransactionKeepOpenOption from '@/components/transactions/transaction-modal/controls/KeepOpenOption'

type TransactionReviewFooterProps = {
  isPending: boolean
  submitLoading: boolean

  /** What a refused press of Add to ledger found missing, which fades it as every dialogue's submit */
  submitBlockedReason?: string
  dismissLoading: boolean
  keepOpen: boolean
  onKeepOpenChange: (value: boolean) => void
  onDismiss: () => void
}

/**
 * The two decisions on a bank item, Dismiss and Add to ledger (the form's submit), beside the
 * choice to go on to the next item after either. Closing the modal leaves the item waiting, so there
 * is no Cancel beside them. Dismiss is drawn and pressed like Delete, twice, because it can't be undone
 * and sits where Cancel usually does
 */
export default function TransactionReviewFooter({
  isPending,
  submitLoading,
  submitBlockedReason,
  dismissLoading,
  keepOpen,
  onKeepOpenChange,
  onDismiss,
}: TransactionReviewFooterProps) {
  return (
    <div
      className={`flex shrink-0 flex-col gap-3 py-4 sm:flex-row sm:items-center min-[1050px]:py-5 ${MODAL_INSET_CLASS_NAME.page}`}
      style={{ borderTop: '1px solid var(--app-border)' }}
    >
      <TransactionKeepOpenOption
        label="Keep window open"
        description="Review one item after another"
        checked={keepOpen}
        disabled={isPending}
        onChange={onKeepOpenChange}
      />
      <div className="relative grid grid-cols-2 gap-3 sm:ml-auto sm:flex sm:items-center">
        <ReviewDecisionButton
          label="Dismiss"
          tone="danger"
          confirm={{ label: 'Yes, dismiss', announcement: 'Press again to dismiss this item for good.' }}
          loading={dismissLoading}
          disabled={isPending}
          onClick={onDismiss}
        />
        <ReviewDecisionButton
          label="Add to ledger"
          tone="primary"
          loading={submitLoading}
          disabled={isPending}
          disabledReason={submitBlockedReason}
          testId="transaction-submit"
        />
        <ShortcutHints placement="save">
          <ShortcutHint submit />
        </ShortcutHints>
      </div>
    </div>
  )
}
