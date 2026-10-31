import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Check, Trash2 } from 'lucide-react'
import { PendingLabel } from '@/components/loading/PendingLabel'
import { useTransactionModalIds } from '@/components/transactions/transaction-modal/ids'
import { MODAL_INSET_CLASS_NAME } from '@/components/modal/inset'
import { DisabledReasonButton } from '@/components/tooltips/DisabledReasonButton'
import ShortcutHint from '@/components/transactions/transaction-modal/controls/ShortcutHint'
import ShortcutHints from '@/components/transactions/transaction-modal/controls/ShortcutHints'
import { ARIA_SUBMIT_SHORTCUT } from '@/components/transactions/transaction-modal/utils/shortcuts'
import type { ModalLevel } from '@/components/modal/Shell'

interface TransactionModalFooterProps {
  level: ModalLevel
  editing: boolean

  /** A refund is saved alone, so there is no batch to keep the modal open for */
  hideKeepOpen: boolean

  /** What the primary action says when it adds, so a refund names itself */
  addLabel: string

  /**
   * Set when the transaction is linked to others. Delete then asks what happens to them, in a dialog
   * the owner opens, instead of arming for a second click
   */
  onRequestLinkedDelete: (() => void) | null
  isPending: boolean
  readOnly: boolean
  submitLoading: boolean

  // Why the form can't go ahead once a press found a problem, shown in a tooltip while Add stays focusable
  submitBlockedReason?: string
  deleteLoading: boolean
  keepOpenAfterCreate: boolean
  onKeepOpenAfterCreateChange: (value: boolean) => void
  onCancel: () => void
  onDelete: () => Promise<boolean>
}

/**
 * Renders modal actions and owns delete confirmation UI state
 */
export default function TransactionModalFooter({
  level,
  editing,
  hideKeepOpen,
  addLabel,
  onRequestLinkedDelete,
  isPending,
  readOnly,
  submitLoading,
  submitBlockedReason,
  deleteLoading,
  keepOpenAfterCreate,
  onKeepOpenAfterCreateChange,
  onCancel,
  onDelete,
}: TransactionModalFooterProps) {
  const ids = useTransactionModalIds()
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const deleteButtonRef = useRef<HTMLButtonElement>(null)
  const idleLabelRef = useRef<HTMLSpanElement>(null)
  const confirmLabelRef = useRef<HTMLSpanElement>(null)
  const [labelWidths, setLabelWidths] = useState<{ idle: number; confirm: number } | null>(null)
  const deleteButtonLoading = deleteLoading && confirmingDelete

  /**
   * Handles the second delete click and resets confirmation when deletion fails
   */
  const handleDeleteClick = () => {
    if (isPending) return
    if (onRequestLinkedDelete) {
      onRequestLinkedDelete()
      return
    }
    if (!confirmingDelete) {
      setConfirmingDelete(true)
      return
    }

    void onDelete().then((deleted) => {
      if (!deleted) setConfirmingDelete(false)
    })
  }

  useLayoutEffect(() => {
    if (!editing) return
    if (idleLabelRef.current && confirmLabelRef.current) {
      setLabelWidths({
        idle: idleLabelRef.current.offsetWidth,
        confirm: confirmLabelRef.current.offsetWidth,
      })
    }
  }, [editing])

  useEffect(() => {
    if (!confirmingDelete || deleteLoading) return
    const onPointer = (event: PointerEvent) => {
      if (deleteButtonRef.current && !deleteButtonRef.current.contains(event.target as Node)) {
        setConfirmingDelete(false)
      }
    }

    // Defers listener registration so the click that arms confirmation does not immediately cancel it
    const timeoutId = window.setTimeout(() => window.addEventListener('pointerdown', onPointer), 0)
    return () => {
      window.clearTimeout(timeoutId)
      window.removeEventListener('pointerdown', onPointer)
    }
  }, [confirmingDelete, deleteLoading])

  return (
    <div
      className={`flex shrink-0 flex-col gap-3 py-4 sm:flex-row sm:items-center min-[1050px]:py-5 ${MODAL_INSET_CLASS_NAME[level]}`}
      style={{ borderTop: '1px solid var(--app-border)' }}
    >
      {editing && !readOnly ? (
        <button
          ref={deleteButtonRef}
          data-testid="transaction-delete"
          aria-label={confirmingDelete ? 'Yes, delete' : 'Delete'}
          aria-busy={deleteButtonLoading}
          type="button"
          onClick={handleDeleteClick}
          disabled={isPending}
          className={`app-danger-button overflow-hidden whitespace-nowrap ${
            deleteButtonLoading ? 'app-primary-button-loading shrink-0' : 'w-full sm:w-auto'
          }`}
        >
          <PendingLabel pending={deleteButtonLoading} name="Deleting">
            <span
              className="relative block"
              style={{
                width: labelWidths ? `${confirmingDelete ? labelWidths.confirm : labelWidths.idle}px` : 'auto',
                height: '1.25rem',
                transition: 'width 220ms cubic-bezier(0.25, 0.1, 0.25, 1)',
              }}
            >
              <span
                ref={idleLabelRef}
                className="invisible absolute inline-flex items-center gap-2 whitespace-nowrap"
                aria-hidden
              >
                <Trash2 size={16} aria-hidden />
                Delete
              </span>
              <span
                ref={confirmLabelRef}
                className="invisible absolute inline-flex items-center gap-2 whitespace-nowrap"
                aria-hidden
              >
                <Check size={16} aria-hidden />
                Yes, delete
              </span>
              <span
                className="absolute inset-0 inline-flex items-center justify-center gap-2 whitespace-nowrap transition-opacity"
                style={{ opacity: confirmingDelete ? 0 : 1 }}
              >
                <Trash2 size={16} aria-hidden />
                Delete
              </span>
              <span
                className="absolute inset-0 inline-flex items-center justify-center gap-2 whitespace-nowrap transition-opacity"
                style={{ opacity: confirmingDelete ? 1 : 0 }}
              >
                <Check size={16} aria-hidden />
                Yes, delete
              </span>
            </span>
          </PendingLabel>
        </button>
      ) : !editing && !hideKeepOpen ? (
        <div className="min-w-0 sm:max-w-xs">
          <label htmlFor={ids.keepOpen} className="-ml-1 flex cursor-pointer items-center gap-3 rounded-xl px-1 py-1">
            <input
              id={ids.keepOpen}
              type="checkbox"
              checked={keepOpenAfterCreate}
              onChange={(event) => onKeepOpenAfterCreateChange(event.target.checked)}
              disabled={isPending}
              className="h-4 w-4 shrink-0 cursor-pointer disabled:cursor-not-allowed"
              style={{ accentColor: 'var(--app-accent)' }}
            />
            <span className="min-w-0">
              <span className="block text-sm font-medium" style={{ color: 'var(--app-text)' }}>
                Keep modal open after adding
              </span>
              <span className="block text-xs" style={{ color: 'var(--app-text-muted)' }}>
                Keep type, date, account, merchant, and category
              </span>
            </span>
          </label>
        </div>
      ) : null}
      <div className="relative grid grid-cols-2 gap-3 sm:ml-auto sm:flex sm:items-center">
        <button
          type="button"
          className={
            readOnly ? 'app-secondary-button col-span-2 w-full sm:w-auto' : 'app-secondary-button w-full sm:w-auto'
          }
          onClick={onCancel}
          disabled={isPending}
        >
          {readOnly ? 'Close' : 'Cancel'}
        </button>
        {!readOnly && (
          <DisabledReasonButton
            type="submit"
            data-testid="transaction-submit"
            aria-label={editing ? 'Save' : addLabel}
            aria-busy={submitLoading}
            aria-keyshortcuts={ARIA_SUBMIT_SHORTCUT}
            disabled={isPending}
            disabledReason={isPending ? undefined : submitBlockedReason}
            className={`app-primary-button overflow-hidden whitespace-nowrap${submitLoading ? ' app-primary-button-loading justify-self-center sm:justify-self-auto' : editing ? ' w-full sm:w-24' : ' w-full sm:w-44'}`}
          >
            <PendingLabel pending={submitLoading} name={editing ? 'Save' : addLabel}>
              {editing ? 'Save' : addLabel}
            </PendingLabel>
          </DisabledReasonButton>
        )}
        {!readOnly && (
          <ShortcutHints placement="save">
            <ShortcutHint submit />
          </ShortcutHints>
        )}
      </div>
    </div>
  )
}
