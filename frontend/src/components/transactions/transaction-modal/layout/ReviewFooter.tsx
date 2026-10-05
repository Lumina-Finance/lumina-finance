import { useFittedButtonWidth } from '@/hooks/useFittedButtonWidth'
import TransactionKeepOpenOption from '@/components/transactions/transaction-modal/controls/KeepOpenOption'

type TransactionReviewFooterProps = {
  isPending: boolean
  submitLoading: boolean
  dismissLoading: boolean
  keepOpen: boolean
  onKeepOpenChange: (value: boolean) => void
  onDismiss: () => void
}

/**
 * The two decisions on a bank item, Dismiss and Add to ledger, which is the form's submit, beside the
 * choice to go on to the next item after either. Closing the modal leaves the item waiting, so there
 * is no Cancel beside them
 *
 * Each button is sized to its label, which it shrinks from into its spinner while its decision runs
 */
export default function TransactionReviewFooter({
  isPending,
  submitLoading,
  dismissLoading,
  keepOpen,
  onKeepOpenChange,
  onDismiss,
}: TransactionReviewFooterProps) {
  const { buttonRef: dismissRef, style: dismissStyle, measure: dismissMeasure } = useFittedButtonWidth('Dismiss')
  const { buttonRef: addRef, style: addStyle, measure: addMeasure } = useFittedButtonWidth('Add to ledger')

  return (
    <div
      className="flex shrink-0 flex-col gap-3 px-6 py-4 sm:flex-row sm:items-center sm:px-8 min-[1050px]:py-5"
      style={{ borderTop: '1px solid var(--app-border)' }}
    >
      <TransactionKeepOpenOption
        label="Keep window open"
        description="Review one item after another"
        checked={keepOpen}
        disabled={isPending}
        onChange={onKeepOpenChange}
      />
      <div className="grid grid-cols-2 gap-3 sm:ml-auto sm:flex sm:items-center">
        <button
          ref={dismissRef}
          type="button"
          aria-label="Dismiss"
          aria-busy={dismissLoading}
          onClick={onDismiss}
          disabled={isPending}
          className={`app-secondary-button relative overflow-hidden whitespace-nowrap duration-300 ${dismissLoading ? 'app-primary-button-loading justify-self-center sm:justify-self-auto' : 'w-full sm:w-(--fit-width)'}`}
          style={dismissStyle}
        >
          {dismissMeasure}
          {dismissLoading ? <div className="app-spinner" /> : 'Dismiss'}
        </button>
        <button
          ref={addRef}
          type="submit"
          data-testid="transaction-submit"
          aria-label="Add to ledger"
          aria-busy={submitLoading}
          disabled={isPending}
          className={`app-primary-button relative overflow-hidden whitespace-nowrap duration-300 ${submitLoading ? 'app-primary-button-loading justify-self-center sm:justify-self-auto' : 'w-full sm:w-(--fit-width)'}`}
          style={addStyle}
        >
          {addMeasure}
          {submitLoading ? <div className="app-spinner" /> : 'Add to ledger'}
        </button>
      </div>
    </div>
  )
}
