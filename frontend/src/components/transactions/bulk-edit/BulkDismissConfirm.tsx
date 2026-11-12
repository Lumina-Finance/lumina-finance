import { CircleX } from 'lucide-react'
import { ModalDeleteConfirm } from '@/components/modal/DeleteConfirm'
import { countNoun } from '@/utils/bankSync'

type BulkDismissConfirmProps = {
  open: boolean
  count: number
  error: string | null
  isDismissing: boolean
  onConfirm: () => void
  onCancel: () => void
}

/**
 * Asks before the ticked items waiting for review are dismissed, whatever the size of the selection
 *
 * A dismissed item stays out of the ledger and only a date range import brings it back, so the
 * choice is asked once for the whole set
 */
export function BulkDismissConfirm({ open, count, error, isDismissing, onConfirm, onCancel }: BulkDismissConfirmProps) {
  return (
    <ModalDeleteConfirm
      open={open}
      label="Bulk dismiss"
      title={`Dismiss ${countNoun(count, 'item')}?`}
      RailIcon={CircleX}
      confirmLabel="Dismiss"
      error={error}
      isDeleting={isDismissing}
      onConfirm={onConfirm}
      onCancel={onCancel}
    >
      <p className="text-sm leading-6" style={{ color: 'var(--app-text)' }}>
        {count === 1 ? 'The item stays' : 'The items stay'} out of your ledger. Only a date range import can bring{' '}
        {count === 1 ? 'the item' : 'them'} back.
      </p>
    </ModalDeleteConfirm>
  )
}
