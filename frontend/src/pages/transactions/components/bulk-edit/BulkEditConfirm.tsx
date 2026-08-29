import { useId } from 'react'
import { ModalShell } from '@/components/modal/Shell'

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
    <ModalShell
      open={open}
      onClose={onCancel}
      titleId={titleId}
      panelClassName="app-modal-panel w-full max-w-md p-5"
      // Opened from the edit modal rather than from the page, so it stacks above it rather than
      // landing on top only because its portal node was appended later
      level="stacked"
      closeDisabled={isApplying}
    >
      <h2 id={titleId} className="text-lg font-semibold">
        Change {count} {count === 1 ? 'transaction' : 'transactions'}?
      </h2>

      <p className="mt-2 text-sm" style={{ color: 'var(--app-text-subtle)' }}>
        This cannot be undone.
      </p>

      {error && (
        <p className="mt-3 text-sm" style={{ color: 'var(--app-negative)' }}>
          {error}
        </p>
      )}

      <div className="mt-5 flex justify-end gap-2">
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
          {isApplying ? <div className="app-spinner" /> : count === 1 ? 'Change it' : 'Change them'}
        </button>
      </div>
    </ModalShell>
  )
}
