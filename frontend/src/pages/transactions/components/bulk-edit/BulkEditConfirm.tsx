import { useId } from 'react'
import { PencilLine } from 'lucide-react'
import { ModalFormFooter } from '@/components/modal/FormFooter'
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
 * at all and the user has to know that nothing changed. Styled like the Add Merchant dialog opened
 * from the transaction form, down to its footer, so a second confirmation stacked over an edit modal
 * reads as the same kind of dialog rather than a different one.
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
      RailIcon={PencilLine}
      railLabel="Bulk edit"
      level="stacked"
      closeDisabled={isApplying}
      footer={(
        <ModalFormFooter
          submitLabel="Confirm"
          submitDisabled={isApplying}
          submitWidthClassName="w-full sm:w-32"
          error={error}
          level="stacked"
          onCancel={onCancel}
          onPrimary={onConfirm}
          primaryOnLeft
        />
      )}
    >
      <WarningCallout>This cannot be undone.</WarningCallout>
    </ModalTitledPanel>
  )
}
