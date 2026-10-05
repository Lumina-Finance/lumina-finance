import { useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { Check, X } from 'lucide-react'
import { ApiError } from '@/api/auth'
import { CONNECTION_NICKNAME_MAX_LENGTH, useRenameBankConnection, type BankConnection } from '@/api/bank-sync'
import { useToast } from '@/hooks/useToast'
import { EASE } from '@/pages/settings/components/bank-connections-section/constants'
import { connectionName } from '@/utils/bankSync'

// Crossfades the title and its field so neither snaps in, as a passkey's rename does
const FIELD_TRANSITION = { duration: 0.18, ease: EASE }

/**
 * The nickname field, which starts from the current nickname each time it opens
 */
function NicknameField({ connection, onDone }: { connection: BankConnection; onDone: () => void }) {
  const { showToast } = useToast()
  const rename = useRenameBankConnection()
  const [draft, setDraft] = useState(connection.nickname ?? '')

  const save = () => {
    if (rename.isPending) return
    if (draft.trim() === (connection.nickname ?? '')) {
      onDone()
      return
    }
    rename.mutate(
      { connectionId: connection.id, nickname: draft.trim() },
      {
        onSuccess: onDone,
        onError: (cause) => showToast({ status: 'error', text: cause instanceof ApiError ? cause.message : 'Could not rename this connection. Please try again.' }),
      },
    )
  }

  return (
    <>
      <input
        className="app-input min-w-0 flex-1"
        value={draft}
        maxLength={CONNECTION_NICKNAME_MAX_LENGTH}
        placeholder={connection.provider_name}
        aria-label="Connection nickname"
        autoFocus
        disabled={rename.isPending}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') save()
          if (event.key === 'Escape') {
            // Leaves the field without closing the modal around it
            event.stopPropagation()
            onDone()
          }
        }}
      />
      <button type="button" className="app-icon-button shrink-0" aria-label="Save nickname" aria-busy={rename.isPending} disabled={rename.isPending} onClick={save}>
        {rename.isPending ? <div className="app-spinner" /> : <Check size={16} aria-hidden />}
      </button>
      <button type="button" className="app-icon-button shrink-0" aria-label="Cancel renaming" disabled={rename.isPending} onClick={onDone}>
        <X size={16} aria-hidden />
      </button>
    </>
  )
}

interface NicknameTitleProps {
  connection: BankConnection
  titleId: string
  editing: boolean
  onEditingChange: (editing: boolean) => void
  prefersReducedMotion: boolean | null
}

/**
 * The connection modal's title, which names the connection by its nickname or its provider and turns
 * into the nickname field while the modal's Rename is in use. Saving a blank nickname clears it, so the
 * provider's name comes back
 */
export function NicknameTitle({ connection, titleId, editing, onEditingChange, prefersReducedMotion }: NicknameTitleProps) {
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
            <NicknameField connection={connection} onDone={() => onEditingChange(false)} />
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
