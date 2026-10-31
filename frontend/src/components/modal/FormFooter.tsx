import { useEffect, useRef } from 'react'
import { FormError } from '@/components/forms/FormError'
import { PendingLabel } from '@/components/loading/PendingLabel'
import { MODAL_INSET_CLASS_NAME } from '@/components/modal/inset'
import type { ModalLevel } from '@/components/modal/Shell'
import { DisabledReasonButton } from '@/components/tooltips/DisabledReasonButton'

// The justify side is applied separately below, since a footer drawn with the primary on the left
// swaps it for sm:justify-between rather than adding to it
const FOOTER_BASE_CLASS_NAME = 'grid shrink-0 grid-cols-2 gap-3 py-4 sm:flex min-[1050px]:py-5'

interface ModalFormFooterProps {
  submitLabel: string
  /** Held down while the submission is in flight, which swaps the label for a spinner and blocks cancelling */
  submitDisabled: boolean
  /**
   * Why the form can't go ahead, once a press found a problem. The submit button then fades but stays
   * focusable, and says so in its tooltip until the form is fixed. Left out by a dialog with nothing to
   * fill in, whose button never fades
   */
  submitBlockedReason?: string
  /** Width classes for the submit button, so a short label does not stretch the whole way across */
  submitWidthClassName: string
  /** Shown beside the actions when the submission failed, rather than against any one field */
  error?: string | null
  /** Id for the message, so a field the failure is about can point to it as its description */
  errorId?: string
  level?: ModalLevel
  onCancel: () => void

  /** Runs the primary action directly and renders it as a plain button, for a panel with nothing to submit */
  onPrimary?: () => void

  /**
   * Adds a Back button beside Cancel, for a step that has an earlier one to return to. On a phone Back
   * and Cancel each take half a row and the primary action has the row below to itself
   */
  onBack?: () => void

  /**
   * Draws the primary button at the left and Cancel at the right, for a confirmation that changes or
   * deletes records. They sit in that order in the DOM too, so Tab moves through them the way they are
   * drawn, and the dialog opens on Cancel so a stray Enter cancels rather than writes
   */
  primaryOnLeft?: boolean

  /** Draws the primary action red, for a confirmation that deletes */
  tone?: 'primary' | 'danger'
}

/**
 * Cancel and submit actions for a modal form, with the submission's own error message beside them
 */
export function ModalFormFooter({
  submitLabel,
  submitDisabled,
  submitBlockedReason,
  submitWidthClassName,
  error,
  errorId,
  level = 'page',
  onCancel,
  onPrimary,
  onBack,
  primaryOnLeft = false,
  tone = 'primary',
}: ModalFormFooterProps) {
  const primaryRef = useRef<HTMLButtonElement>(null)
  const primaryHadFocus = useRef(false)

  // Disabling a focused button drops focus to the page, which leaves the next Tab starting from the top of
  // the modal after a refused submission. A press of the button is noted, and once it is live again it
  // takes focus back, unless the person moved focus somewhere else meanwhile
  useEffect(() => {
    if (submitDisabled) return
    if (primaryHadFocus.current && document.activeElement === document.body) primaryRef.current?.focus()
    primaryHadFocus.current = false
  }, [submitDisabled])

  // Below sm an error between the buttons would split them across rows, so it is drawn first on a row of
  // its own, while it stays between them in the DOM and in the single row from sm
  const errorMessage = (
    <FormError
      message={error}
      id={errorId}
      className={`col-span-2 sm:col-span-1 ${primaryOnLeft ? 'order-first sm:order-none' : 'sm:mr-auto'}`}
    />
  )
  const cancelButton = (
    <button
      type="button"
      className="app-secondary-button w-full sm:w-auto"
      onClick={onCancel}
      disabled={submitDisabled}
      data-modal-initial-focus={primaryOnLeft ? 'true' : undefined}
    >
      Cancel
    </button>
  )
  const backAndCancel = onBack ? (
    <div className="contents sm:flex sm:shrink-0 sm:gap-3">
      <button
        type="button"
        className="app-secondary-button w-full sm:w-auto"
        onClick={onBack}
        disabled={submitDisabled}
      >
        Back
      </button>
      {cancelButton}
    </div>
  ) : (
    cancelButton
  )
  const primaryButton = (
    <DisabledReasonButton
      ref={primaryRef}
      type={onPrimary ? 'button' : 'submit'}
      onClick={() => {
        primaryHadFocus.current = true
        onPrimary?.()
      }}
      disabled={submitDisabled}
      disabledReason={submitDisabled ? undefined : submitBlockedReason}
      aria-busy={submitDisabled}
      className={`${tone === 'danger' ? 'app-danger-button' : 'app-primary-button'} shrink-0${onBack ? ' col-span-2 sm:col-span-1' : ''}${submitDisabled ? ' app-primary-button-loading justify-self-center sm:justify-self-auto' : ` ${submitWidthClassName}`}`}
    >
      {/* The spinner replaces the label, so it carries the label as its own name and a screen reader still
          says which action is in flight */}
      <PendingLabel pending={submitDisabled} name={submitLabel}>
        {submitLabel}
      </PendingLabel>
    </DisabledReasonButton>
  )

  return (
    <div
      data-toast-keep-clear
      className={`${FOOTER_BASE_CLASS_NAME} ${MODAL_INSET_CLASS_NAME[level]} ${primaryOnLeft ? 'sm:justify-between' : 'sm:justify-end'} ${error ? 'items-center' : ''}`}
      style={{ borderTop: '1px solid var(--app-border)' }}
    >
      {primaryOnLeft ? (
        <>
          {primaryButton}
          {errorMessage}
          {backAndCancel}
        </>
      ) : (
        <>
          {errorMessage}
          {backAndCancel}
          {primaryButton}
        </>
      )}
    </div>
  )
}
