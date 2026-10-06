import { useId } from 'react'
import { Trash2 } from 'lucide-react'
import { ModalFormFooter } from '@/components/modal/FormFooter'
import { ModalTitledPanel } from '@/components/modal/TitledPanel'
import { WarningCallout } from '@/components/WarningCallout'

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
 * A refusal keeps this open and shows what the server said, since the set is deleted whole or not at
 * all and the user has to know that nothing was removed
 */
export function BulkDeleteConfirm({
  open,
  count,
  error,
  isDeleting,
  onConfirm,
  onCancel,
}: BulkDeleteConfirmProps) {
  const titleId = useId()

  return (
    <ModalTitledPanel
      open={open}
      onClose={onCancel}
      titleId={titleId}
      eyebrow="Bulk delete"
      title={`Delete ${count} ${count === 1 ? 'transaction' : 'transactions'}?`}
      RailIcon={Trash2}
      railLabel="Bulk delete"
      closeDisabled={isDeleting}
      footer={(
        <ModalFormFooter
          submitLabel="Delete"
          submitDisabled={isDeleting}
          submitWidthClassName="w-full sm:w-auto"
          error={error}
          onCancel={onCancel}
          onPrimary={onConfirm}
          primaryOnLeft
          tone="danger"
        />
      )}
    >
      <WarningCallout>This can't be undone.</WarningCallout>
    </ModalTitledPanel>
  )
}
