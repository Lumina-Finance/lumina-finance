import { useId } from 'react'
import { Download } from 'lucide-react'
import { ModalFormFooter } from '@/components/modal/FormFooter'
import { ModalTitledPanel } from '@/components/modal/TitledPanel'

type ExportAllConfirmProps = {
  open: boolean
  onConfirm: () => void
  onCancel: () => void
}

/**
 * Asks before the whole transaction history downloads, which is what the export button saves when
 * nothing narrows the list and nothing is ticked
 *
 * Nothing is written, so Cancel sits left of the primary button as in any non-destructive
 * confirmation. A narrowed or ticked export never asks, since its button names what it saves
 */
export function ExportAllConfirm({ open, onConfirm, onCancel }: ExportAllConfirmProps) {
  const titleId = useId()
  const descriptionId = useId()

  return (
    <ModalTitledPanel
      open={open}
      onClose={onCancel}
      titleId={titleId}
      descriptionId={descriptionId}
      eyebrow="Export"
      title="Download all your transactions?"
      RailIcon={Download}
      railLabel="Export"
      footer={
        <ModalFormFooter
          submitLabel="Download all"
          submitDisabled={false}
          submitWidthClassName="w-full sm:w-auto"
          onCancel={onCancel}
          onPrimary={onConfirm}
        />
      }
    >
      <p id={descriptionId} className="text-sm leading-6" style={{ color: 'var(--app-text)' }}>
        To export only some, cancel and search or filter the list first.
      </p>
    </ModalTitledPanel>
  )
}
