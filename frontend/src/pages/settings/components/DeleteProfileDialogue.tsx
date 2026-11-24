import { useId, useState } from 'react'
import { UserX } from 'lucide-react'
import { FieldError } from '@/components/forms/FieldError'
import { ModalFormFooter } from '@/components/modal/FormFooter'
import { ModalTitledPanel } from '@/components/modal/TitledPanel'
import { WarningCallout } from '@/components/WarningCallout'
import { isDeletionConfirmed } from '@/pages/settings/utils/deleteProfile'

const CONFIRM_WORD_MISSING = 'Please type delete to confirm'
const EXPORT_RUNNING = 'Please wait for the export to finish'

type DeleteProfileDialogueProps = {
  open: boolean
  /** Shows the sentence about the bank sync provider's charges. Only a user with a bank connection needs it */
  hasBankConnections: boolean
  exporting: boolean
  onExport: () => void
  onConfirm: () => void
  onCancel: () => void
}

/**
 * Asks before the user's profile and everything they own is deleted. The user types "delete" first,
 * and the export is offered as a link in the text, so the footer keeps the two buttons every
 * confirmation has
 */
export function DeleteProfileDialogue({
  open,
  hasBankConnections,
  exporting,
  onExport,
  onConfirm,
  onCancel,
}: DeleteProfileDialogueProps) {
  const titleId = useId()
  const descriptionId = useId()
  const inputId = useId()
  const errorId = useId()
  const [typed, setTyped] = useState('')
  const [pressed, setPressed] = useState(false)
  const confirmed = isDeletionConfirmed(typed)
  const error = pressed && !confirmed ? CONFIRM_WORD_MISSING : null

  function close() {
    setTyped('')
    setPressed(false)
    onCancel()
  }

  function confirm() {
    // The export the dialogue offers finishes first, since signing out would drop the file it is saving
    if (exporting) return
    setPressed(true)
    if (confirmed) onConfirm()
  }

  return (
    <ModalTitledPanel
      open={open}
      onClose={close}
      titleId={titleId}
      descriptionId={descriptionId}
      eyebrow="Delete profile"
      title="Delete your profile and all your data?"
      RailIcon={UserX}
      railLabel="Delete profile"
      footer={
        <ModalFormFooter
          submitLabel="Delete profile"
          submitDisabled={false}
          submitBlockedReason={exporting ? EXPORT_RUNNING : (error ?? undefined)}
          submitWidthClassName="w-full sm:w-auto"
          onCancel={close}
          onPrimary={confirm}
          primaryOnLeft
          tone="danger"
        />
      }
    >
      <div id={descriptionId} className="space-y-4 text-sm leading-6" style={{ color: 'var(--app-text)' }}>
        <WarningCallout>This will permanently delete all your data and is irrevocable.</WarningCallout>
        {hasBankConnections && (
          <p>
            Your subscriptions and related charges with the bank sync provider will not be cancelled automatically.
            Please reach out to them to manage your subscriptions.
          </p>
        )}
        <p>
          Want a copy first?{' '}
          <button
            type="button"
            className="app-inline-link font-medium underline underline-offset-2 disabled:cursor-wait disabled:opacity-50"
            onClick={onExport}
            disabled={exporting}
          >
            Export all data
          </button>
        </p>
        <div>
          <div className="mb-1.5 flex flex-wrap items-start justify-between gap-x-3">
            <label htmlFor={inputId} className="block text-sm leading-5" style={{ color: 'var(--app-text-muted)' }}>
              Type <strong className="font-semibold">"delete"</strong> to confirm.
            </label>
            <FieldError message={error} id={errorId} className="ml-auto min-w-0" />
          </div>
          <input
            id={inputId}
            className={`app-input ${error ? 'app-input-error' : ''}`}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? errorId : undefined}
            value={typed}
            onChange={(event) => setTyped(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== 'Enter') return
              event.preventDefault()
              confirm()
            }}
            autoComplete="off"
          />
        </div>
      </div>
    </ModalTitledPanel>
  )
}
