import { Trash2 } from 'lucide-react'
import { ModalDeleteConfirm } from '@/components/modal/DeleteConfirm'

type BulkDeleteConfirmProps = {
  open: boolean
  count: number
  error: string | null
  isDeleting: boolean
  onConfirm: () => void
  onCancel: () => void
}

/**
 * Asks before the ticked transactions are deleted, whatever the size of the selection
 *
 * The set is deleted whole or not at all, so a refusal stays open saying nothing was removed
 */
export function BulkDeleteConfirm({
  open,
  count,
  error,
  isDeleting,
  onConfirm,
  onCancel,
}: BulkDeleteConfirmProps) {
  return (
    <ModalDeleteConfirm
      open={open}
      label="Bulk delete"
      title={`Delete ${count} ${count === 1 ? 'transaction' : 'transactions'}?`}
      RailIcon={Trash2}
      confirmLabel="Delete"
      error={error}
      isDeleting={isDeleting}
      onConfirm={onConfirm}
      onCancel={onCancel}
    />
  )
}
