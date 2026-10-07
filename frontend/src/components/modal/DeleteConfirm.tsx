import { useId, type ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'
import { ModalFormFooter } from '@/components/modal/FormFooter'
import { ModalTitledPanel } from '@/components/modal/TitledPanel'
import { WarningCallout } from '@/components/WarningCallout'

type ModalDeleteConfirmProps = {
  open: boolean

  /** Names the action above the title and along the rail */
  label: string
  title: string
  RailIcon: LucideIcon
  confirmLabel: string

  error: string | null
  isDeleting: boolean
  onConfirm: () => void
  onCancel: () => void

  /** What is deleted and what is kept, above the warning that it can't be undone */
  children?: ReactNode
}

/**
 * Asks before something is deleted for good, with a red confirm button on the left, as wide as its label, and the warning that it
 * can't be undone
 *
 * A refusal keeps this open and shows what the server said, since a delete that refuses removes
 * nothing and the user has to know that
 */
export function ModalDeleteConfirm({
  open,
  label,
  title,
  RailIcon,
  confirmLabel,
  error,
  isDeleting,
  onConfirm,
  onCancel,
  children,
}: ModalDeleteConfirmProps) {
  const titleId = useId()
  const descriptionId = useId()

  return (
    <ModalTitledPanel
      open={open}
      onClose={onCancel}
      titleId={titleId}
      descriptionId={descriptionId}
      eyebrow={label}
      title={title}
      RailIcon={RailIcon}
      railLabel={label}
      closeDisabled={isDeleting}
      footer={(
        <ModalFormFooter
          submitLabel={confirmLabel}
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
      <div id={descriptionId} className="space-y-4">
        {children}
        <WarningCallout>This can't be undone.</WarningCallout>
      </div>
    </ModalTitledPanel>
  )
}
