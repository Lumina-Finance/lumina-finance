import { useId } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { AlertTriangle, EyeOff } from 'lucide-react'
import type { Account } from '@/api/accounts'
import { FieldError } from '@/components/forms/FieldError'
import { getFocusableElements } from '@/components/modal/focus'
import { useRevealWhenGrown } from '@/pages/accounts/detail/hooks/useRevealWhenGrown'
import { DisabledReasonButton } from '@/components/tooltips/DisabledReasonButton'
import {
  ARCHIVE_BLOCKED_BY_LATER_TRANSACTIONS_REASON,
  EDIT_ACCOUNT_IDENTITY_FIELD_IDS,
  EASE,
} from '@/pages/accounts/detail/constants/accountDetail'
import type { DeleteStage } from '@/pages/accounts/detail/components/edit-identity/types'

type DeleteAccountPanelProps = {
  account: Account
  deleteStage: DeleteStage
  deleteNameInput: string
  deleteError: string | null
  deleteLoading: boolean
  isBusy: boolean
  /** Why the typed name was refused, shown on the name field's label row until it matches the account's */
  nameError?: string

  /** Fades Delete account with this reason once a press found the typed name wrong */
  blockedReason?: string
  /** Disables the archive shortcut for the same reason the archive switch is locked */
  isArchiveBlocked: boolean
  onArchiveInstead: () => void
  onContinue: () => void
  onDelete: () => void
  onNameChange: (value: string) => void
}

/**
 * Renders the destructive delete confirmation flow separately from the account form
 */
export function DeleteAccountPanel({
  account,
  deleteStage,
  deleteNameInput,
  deleteError,
  deleteLoading,
  isBusy,
  nameError,
  blockedReason,
  isArchiveBlocked,
  onArchiveInstead,
  onContinue,
  onDelete,
  onNameChange,
}: DeleteAccountPanelProps) {
  const questionId = useId()
  const { ref: panelRef, reveal: revealPanel } = useRevealWhenGrown<HTMLDivElement>(deleteStage !== 'idle')

  // The trash button that opens the panel and the Continue button that leads on are gone once pressed, so
  // each step that grows in takes focus on its first control rather than leaving it on the page
  const revealStep = () => {
    const panel = revealPanel()
    if (panel) getFocusableElements(panel)[0]?.focus({ preventScroll: true })
  }

  return (
    <AnimatePresence initial={false}>
      {deleteStage !== 'idle' && (
        <motion.div
          ref={panelRef}
          role="group"
          aria-labelledby={questionId}
          onAnimationComplete={revealStep}
          // Starts where the sections' content does: past the step number column (1rem) and its gap
          // (0.5rem, 0.75rem from 1050px), as in layout/Section.tsx
          className="overflow-hidden ml-6 min-[1050px]:ml-7"
          initial={{ height: 0, marginTop: 0, opacity: 0 }}
          animate={{ height: 'auto', marginTop: 20, opacity: 1 }}
          exit={{ height: 0, marginTop: 0, opacity: 0 }}
          transition={{ duration: 0.2, ease: EASE }}
        >
          <motion.div
            layout
            className="rounded-lg px-3 py-2.5"
            style={{
              background: 'var(--app-negative-soft)',
              border: '1px solid var(--app-border)',
            }}
            transition={{ duration: 0.22, ease: EASE }}
          >
            <div className="flex gap-2.5">
              <div
                className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md"
                style={{ background: 'var(--app-bg)', color: 'var(--app-negative)' }}
              >
                <AlertTriangle size={13} aria-hidden />
              </div>
              <div className="min-w-0 flex-1">
                <p id={questionId} className="break-words text-sm font-semibold leading-5">
                  Delete {account.name}?
                </p>
                <p className="mt-0.5 text-sm leading-5" style={{ color: 'var(--app-text-muted)' }}>
                  Permanent deletion removes its transactions, budgets, and balance history. Archive it instead
                  if you only want it out of view.
                </p>

                <div className="mt-3 overflow-hidden">
                  <AnimatePresence initial={false} mode="wait">
                    {deleteStage === 'confirm' ? (
                      <motion.div
                        key="confirm"
                        className="overflow-hidden"
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.18, ease: EASE }}
                      >
                        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                          {!account.is_archived ? (
                            <DisabledReasonButton
                              className="group inline-flex items-center gap-2 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-60 aria-disabled:cursor-not-allowed"
                              style={{ color: 'var(--app-text-muted)' }}
                              onClick={onArchiveInstead}
                              disabled={isBusy}
                              disabledReason={!isBusy && isArchiveBlocked ? ARCHIVE_BLOCKED_BY_LATER_TRANSACTIONS_REASON : undefined}
                              // The archive section above already prints this reason, so it describes the button
                              reasonShownById={EDIT_ACCOUNT_IDENTITY_FIELD_IDS.archiveBlockedReason}
                            >
                              {/* The faded label stands for unavailable, and the button itself stays whole so its focus ring does not fade */}
                              <span className="inline-flex items-center gap-2 group-aria-disabled:opacity-60">
                                <EyeOff size={15} aria-hidden />
                                Archive instead
                              </span>
                            </DisabledReasonButton>
                          ) : (
                            <span aria-hidden />
                          )}
                          <button
                            type="button"
                            className="app-danger-button justify-center sm:ml-auto"
                            onClick={onContinue}
                            disabled={isBusy}
                          >
                            Continue
                          </button>
                        </div>
                      </motion.div>
                    ) : (
                      <motion.div
                        key="type-name"
                        onAnimationComplete={revealStep}
                        className="overflow-hidden"
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.18, ease: EASE }}
                      >
                        <div>
                          <div className="mb-1.5 flex flex-wrap items-start justify-between gap-x-3">
                            <label
                              htmlFor={EDIT_ACCOUNT_IDENTITY_FIELD_IDS.deleteName}
                              className="block min-w-0 break-words text-sm leading-5"
                              style={{ color: 'var(--app-text-muted)' }}
                            >
                              Type <strong className="font-semibold">"{account.name}"</strong> to delete.
                            </label>
                            <FieldError
                              message={nameError}
                              id={EDIT_ACCOUNT_IDENTITY_FIELD_IDS.deleteNameError}
                              className="ml-auto min-w-0"
                            />
                          </div>
                          <input
                            id={EDIT_ACCOUNT_IDENTITY_FIELD_IDS.deleteName}
                            className={`app-input ${nameError ? 'app-input-error' : ''}`}
                            aria-invalid={nameError ? true : undefined}
                            aria-describedby={nameError ? EDIT_ACCOUNT_IDENTITY_FIELD_IDS.deleteNameError : undefined}
                            value={deleteNameInput}
                            onChange={(event) => {
                              onNameChange(event.target.value)
                            }}
                            onKeyDown={(event) => {
                              if (event.key !== 'Enter') return
                              event.preventDefault()
                              onDelete()
                            }}
                            disabled={isBusy}
                            autoComplete="off"
                          />

                          {deleteError && (
                            <p className="mt-3 text-[0.9375rem] font-medium" style={{ color: 'var(--app-negative)' }}>
                              {deleteError}
                            </p>
                          )}

                          <div className="mt-4 flex justify-end">
                            <DisabledReasonButton
                              className={`app-danger-button justify-center overflow-hidden whitespace-nowrap duration-300 ${deleteLoading ? 'app-primary-button-loading shrink-0' : 'w-full min-[1050px]:w-auto'}`}
                              onClick={onDelete}
                              disabled={isBusy}
                              disabledReason={isBusy ? undefined : blockedReason}
                              aria-label="Delete account"
                              aria-busy={deleteLoading}
                            >
                              {deleteLoading ? <span className="app-spinner" /> : 'Delete account'}
                            </DisabledReasonButton>
                          </div>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
