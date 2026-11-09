import { useId, useRef, useState } from 'react'
import { AnimatePresence, motion, useIsPresent } from 'motion/react'
import { Check, X } from 'lucide-react'
import { getSaveFailureMessage } from '@/utils/createFailure'
import type { BankConnection, useRenameBankConnection } from '@/api/bank-sync'
import { FieldLabelRow } from '@/components/forms/FieldLabelRow'
import { PendingLabel } from '@/components/loading/PendingLabel'
import { DisabledReasonButton } from '@/components/tooltips/DisabledReasonButton'
import { useRefusedSubmit } from '@/hooks/useRefusedSubmit'
import { useToast } from '@/hooks/useToast'
import { CONTENT_EASE_CURVE } from '@/utils/widthEase'
import { getNicknameProblem } from '@/pages/settings/components/bank-connections-section/utils'
import { connectionName } from '@/utils/bankSync'

// Crossfades the title and its field so neither snaps in, as a passkey's rename does
const FIELD_TRANSITION = { duration: 0.18, ease: CONTENT_EASE_CURVE }

const NICKNAME_FIELDS = ['nickname'] as const

/** The connection's rename. The modal holds it so that the modal stays open while one is on its way */
type RenameMutation = ReturnType<typeof useRenameBankConnection>

/**
 * The nickname field. It starts from the current nickname each time it opens
 */
function NicknameField({
  connection,
  rename,
  onDone,
}: {
  connection: BankConnection
  rename: RenameMutation
  onDone: () => void
}) {
  const { showToast } = useToast()
  const [draft, setDraft] = useState(connection.nickname ?? '')
  const inputId = useId()
  const errorId = `${inputId}-error`

  // A nickname past the limit is refused with a message on the field, as an over-long note is, and Save
  // fades with the reason until it is shortened
  const refusal = useRefusedSubmit({ nickname: getNicknameProblem(draft) }, NICKNAME_FIELDS, { nickname: inputId })
  const problem = refusal.errors.nickname

  // Once a nickname is saved, editing ends and the field fades out still holding the rename as it was
  // while on its way. Leaving, it stops spinning, since the modal's close is already back, and stays
  // disabled so nothing more is sent from it
  const isPresent = useIsPresent()
  const isSaving = rename.isPending && isPresent

  // Set as a save goes out, since the rename only reads as pending here on the field's next render, and
  // a key pressed before then, such as Escape straight after Enter, must already find the save on its
  // way. It clears once the save comes back: a failed one leaves what was typed to try again, and Rename
  // pressed again while this field fades out brings this same field back, ready to save again
  const saveSent = useRef(false)

  const save = () => {
    if (saveSent.current) return
    if (!refusal.guard()) return
    if (draft.trim() === (connection.nickname ?? '')) {
      onDone()
      return
    }
    saveSent.current = true
    rename.mutate(
      { connectionId: connection.id, nickname: draft.trim() },
      {
        onSuccess: onDone,
        onError: (cause) => {
          showToast({
            status: 'error',
            text: getSaveFailureMessage(cause, 'Could not rename this connection. Please try again.'),
          })
        },
        onSettled: () => {
          saveSent.current = false
        },
      },
    )
  }

  // Leaves the field, though not while a save is on its way, since a failed one comes back to it
  const cancel = () => {
    if (!saveSent.current) onDone()
  }

  return (
    <div className="min-w-0 flex-1">
      {/* The label row only takes room while there is a problem to show, so the resting rename stays one line */}
      <AnimatePresence initial={false}>
        {problem && (
          <motion.div
            key="nickname-problem"
            className="overflow-hidden"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={FIELD_TRANSITION}
          >
            <FieldLabelRow
              label="Nickname"
              htmlFor={inputId}
              error={problem}
              errorId={errorId}
              compact
              spacingClassName="mb-1"
            />
          </motion.div>
        )}
      </AnimatePresence>
      <div className="flex items-center gap-1.5">
        <input
          id={inputId}
          className={`app-input min-w-0 flex-1 ${problem ? 'app-input-error' : ''}`}
          value={draft}
          placeholder={connection.provider_name}
          aria-label="Connection nickname"
          aria-invalid={problem ? true : undefined}
          aria-describedby={problem ? errorId : undefined}
          autoFocus
          disabled={rename.isPending}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') save()
            if (event.key === 'Escape') {
              // Leaves the field without closing the modal around it
              event.stopPropagation()
              cancel()
            }
          }}
        />
        <DisabledReasonButton
          type="button"
          className="app-icon-button shrink-0"
          aria-label="Save nickname"
          aria-busy={isSaving}
          disabled={rename.isPending}
          disabledReason={rename.isPending ? undefined : refusal.blockedReason}
          onClick={save}
        >
          <PendingLabel pending={isSaving} name="Save nickname">
            <Check size={16} aria-hidden />
          </PendingLabel>
        </DisabledReasonButton>
        <button
          type="button"
          className="app-icon-button shrink-0"
          aria-label="Cancel renaming"
          disabled={rename.isPending}
          onClick={cancel}
        >
          <X size={16} aria-hidden />
        </button>
      </div>
    </div>
  )
}

interface NicknameTitleProps {
  connection: BankConnection
  rename: RenameMutation
  titleId: string
  editing: boolean
  onEditingChange: (editing: boolean) => void
  prefersReducedMotion: boolean | null
}

/**
 * The connection modal's title. It names the connection by its nickname or its provider and turns
 * into the nickname field while the modal's Rename is in use. Saving a blank nickname clears it, so the
 * provider's name comes back
 */
export function NicknameTitle({
  connection,
  rename,
  titleId,
  editing,
  onEditingChange,
  prefersReducedMotion,
}: NicknameTitleProps) {
  const transition = prefersReducedMotion ? { duration: 0 } : FIELD_TRANSITION

  return (
    // Both states share one grid cell, tall enough for the field, so switching never moves what sits below
    <div className="grid min-h-10 min-w-0 grid-cols-1 items-center">
      {/* Names the modal in both states, since the heading leaves while the field is open */}
      <span id={titleId} hidden>
        {connectionName(connection)}
      </span>
      <AnimatePresence initial={false}>
        {editing ? (
          <motion.div
            key="edit"
            className="flex min-w-0 items-center gap-1.5"
            style={{ gridArea: '1 / 1' }}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={transition}
          >
            <NicknameField connection={connection} rename={rename} onDone={() => onEditingChange(false)} />
          </motion.div>
        ) : (
          <motion.h2
            key="view"
            className="min-w-0 truncate font-serif text-3xl font-normal leading-10"
            style={{ gridArea: '1 / 1' }}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={transition}
          >
            {connectionName(connection)}
          </motion.h2>
        )}
      </AnimatePresence>
    </div>
  )
}
