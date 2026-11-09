import { useId } from 'react'
import { PencilLine } from 'lucide-react'
import { ModalFormFooter } from '@/components/modal/FormFooter'
import { ModalTitledPanel } from '@/components/modal/TitledPanel'
import { WarningCallout } from '@/components/WarningCallout'
import { countNoun } from '@/utils/bankSync'

interface BulkEditConfirmProps {
  open: boolean
  count: number

  /** How many items waiting for review the same edit adds to the ledger, named in the title beside the transactions */
  reviewCount?: number
  error: string | null
  isApplying: boolean
  onConfirm: () => void
  onCancel: () => void
}

/**
 * Asks before a bulk edit is written, whatever the size of the selection, over the edit modal
 *
 * A refusal keeps this open and shows what the server said, since the batch is applied whole or not
 * at all and the user has to know that nothing changed. Styled like the Add merchant dialog opened
 * from the transaction form, down to its footer, so a second confirmation stacked over an edit modal
 * reads as the same kind of dialog rather than a different one.
 */
export function BulkEditConfirm({
  open,
  count,
  reviewCount = 0,
  error,
  isApplying,
  onConfirm,
  onCancel,
}: BulkEditConfirmProps) {
  const titleId = useId()
  const descriptionId = useId()
  const transactions = countNoun(count, 'transaction')
  const title =
    reviewCount === 0 ? `Change ${transactions}?` : `Add ${countNoun(reviewCount, 'item')} and change ${transactions}?`

  return (
    <ModalTitledPanel
      open={open}
      onClose={onCancel}
      titleId={titleId}
      descriptionId={descriptionId}
      eyebrow="Bulk edit"
      title={title}
      RailIcon={PencilLine}
      railLabel="Bulk edit"
      level="stacked"
      closeDisabled={isApplying}
      footer={
        <ModalFormFooter
          submitLabel="Confirm"
          submitDisabled={isApplying}
          submitWidthClassName="w-full sm:w-auto"
          error={error}
          level="stacked"
          onCancel={onCancel}
          onPrimary={onConfirm}
          primaryOnLeft
        />
      }
    >
      <div id={descriptionId}>
        <WarningCallout>This cannot be undone.</WarningCallout>
      </div>
    </ModalTitledPanel>
  )
}
