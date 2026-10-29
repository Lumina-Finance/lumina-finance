import { Trash2 } from 'lucide-react'
import { ModalDeleteConfirm } from '@/components/modal/DeleteConfirm'
import { LinkedDeleteChoice } from '@/components/transactions/LinkedDeleteChoice'

type BulkDeleteConfirmProps = {
  open: boolean
  count: number

  /** How many transactions outside the selection are linked to it */
  linkedCount: number
  deleteLinked: boolean
  onDeleteLinkedChange: (value: boolean) => void
  error: string | null
  isDeleting: boolean
  onConfirm: () => void
  onCancel: () => void
}

/**
 * Asks before the ticked transactions are deleted, whatever the size of the selection
 *
 * The set is deleted whole or not at all, so a refusal stays open saying nothing was removed. When
 * the selection is linked to transactions outside it, it also asks whether those go too
 */
export function BulkDeleteConfirm({
  open,
  count,
  linkedCount,
  deleteLinked,
  onDeleteLinkedChange,
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
    >
      <LinkedDeleteChoice
        linkedCount={linkedCount}
        subject={count === 1 ? 'this transaction' : 'the selected transactions'}
        checked={deleteLinked}
        disabled={isDeleting}
        onChange={onDeleteLinkedChange}
      />
    </ModalDeleteConfirm>
  )
}
