import { useId } from 'react'
import { ModalTitledPanel } from '@/components/modal/TitledPanel'
import { WarningCallout } from '@/components/WarningCallout'

interface BulkEditConfirmProps {
  open: boolean
  count: number
  error: string | null
  isApplying: boolean
  onConfirm: () => void
  onCancel: () => void
}

/**
 * Asks before a bulk edit is written, whatever the size of the selection, over the edit modal
 *
 * A refusal keeps this open and shows what the server said, since the batch is applied whole or not
 * at all and the user has to know that nothing changed.
 */
export function BulkEditConfirm({
  open,
  count,
  error,
  isApplying,
  onConfirm,
  onCancel,
}: BulkEditConfirmProps) {
  const titleId = useId()

  return (
    <ModalTitledPanel
      open={open}
      onClose={onCancel}
      titleId={titleId}
      eyebrow="Bulk edit"
      title={`Change ${count} ${count === 1 ? 'transaction' : 'transactions'}?`}
      widthClassName="max-w-md"
      level="stacked"
      closeDisabled={isApplying}
      footer={(
        // Row-reverse keeps Cancel ahead of Confirm in the DOM, so the first stops a Tab reaches,
        // the close button and then Cancel, both abandon the batch, while drawing Cancel at the
        // right beside the primary button
        <div
          className="flex shrink-0 flex-row-reverse justify-between gap-2 px-4 py-4 min-[1050px]:px-7"
          style={{ borderTop: '1px solid var(--app-border)' }}
        >
          <button
            type="button"
            className="app-secondary-button h-9 px-3 text-sm"
            onClick={onCancel}
            disabled={isApplying}
          >
            Cancel
          </button>
          <button
            type="button"
            className="app-primary-button h-9 px-4 text-sm"
            onClick={onConfirm}
            disabled={isApplying}
          >
            {isApplying ? <div className="app-spinner" /> : 'Confirm'}
          </button>
        </div>
      )}
    >
      <WarningCallout>This cannot be undone.</WarningCallout>

      {error && (
        <p className="mt-3 text-sm" role="alert" style={{ color: 'var(--app-negative)' }}>
          {error}
        </p>
      )}
    </ModalTitledPanel>
  )
}
