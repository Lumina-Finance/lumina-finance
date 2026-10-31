import { Trash2 } from 'lucide-react'
import { ModalDeleteConfirm } from '@/components/modal/DeleteConfirm'
import { LinkedDeleteChoice } from '@/components/transactions/LinkedDeleteChoice'

interface LinkedDeleteConfirmProps {
  open: boolean

  /** How many transactions are linked to the open one */
  linkedCount: number
  deleteLinked: boolean
  onDeleteLinkedChange: (value: boolean) => void
  error: string | null
  isDeleting: boolean
  onConfirm: () => void
  onCancel: () => void
}

/**
 * Opens over the transaction modal when Delete is pressed on a linked transaction, asking whether the
 * transactions linked to it stay with only the link removed, or are deleted too
 */
export default function TransactionModalLinkedDeleteConfirm({
  open,
  linkedCount,
  deleteLinked,
  onDeleteLinkedChange,
  error,
  isDeleting,
  onConfirm,
  onCancel,
}: LinkedDeleteConfirmProps) {
  return (
    <ModalDeleteConfirm
      open={open}
      level="stacked"
      label="Delete transaction"
      title="Delete this transaction?"
      RailIcon={Trash2}
      confirmLabel="Delete"
      error={error}
      isDeleting={isDeleting}
      onConfirm={onConfirm}
      onCancel={onCancel}
    >
      <LinkedDeleteChoice
        linkedCount={linkedCount}
        subject="this transaction"
        checked={deleteLinked}
        disabled={isDeleting}
        onChange={onDeleteLinkedChange}
      />
    </ModalDeleteConfirm>
  )
}
