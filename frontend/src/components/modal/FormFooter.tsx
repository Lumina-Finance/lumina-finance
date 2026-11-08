import { useCallback, useEffect, useRef } from 'react'
import { FormError } from '@/components/forms/FormError'
import { PendingLabel } from '@/components/loading/PendingLabel'
import { MODAL_INSET_CLASS_NAME } from '@/components/modal/inset'
import type { ModalLevel } from '@/components/modal/Shell'
import { DisabledReasonButton } from '@/components/tooltips/DisabledReasonButton'
import { useFittedButtonWidth } from '@/hooks/useFittedButtonWidth'

// The justify side is applied separately below, since a footer drawn with the primary on the left
// swaps it for sm:justify-between rather than adding to it
const FOOTER_BASE_CLASS_NAME = 'grid shrink-0 grid-cols-2 gap-3 py-4 sm:flex min-[1050px]:py-5'

interface ModalFormFooterProps {
  submitLabel: string
  /** Held down while the submission is in flight. It swaps the label for a spinner and, by default, blocks cancelling */
  submitDisabled: boolean
  /**
   * Why the form can't go ahead, once a press found a problem. The submit button then fades but stays
   * focusable, and says so in its tooltip until the form is fixed. Left out by a dialog with nothing to
   * fill in, whose button never fades
   */
  submitBlockedReason?: string
  /** Blocks cancelling, following submitDisabled unless set. False leaves Cancel open for a form waiting on a submission it can leave */
  cancelDisabled?: boolean
  /**
   * Holds the submit button with a reason the form can't fix, shown on it the way any unavailable
   * button shows its own, and taking the place of submitBlockedReason while it is set
   */
  submitReason?: string | null

  /** The id of an element in the modal that already prints the submit reason, which then describes the button */
  submitReasonShownById?: string
  /** Width classes for the submit button, so a short label does not stretch the whole way across */
  submitWidthClassName: string
  /** Shown beside the actions when the submission failed, rather than against any one field */
  error?: string | null
  /** Id for the message, so a field the failure is about can point to it as its description */
  errorId?: string
  level?: ModalLevel
  onCancel: () => void

  /** Names the dismissing action where Cancel would read as undoing something already saved */
  cancelLabel?: string

  /** Runs the primary action directly and renders it as a plain button, for a panel with nothing to submit */
  onPrimary?: () => void

  /**
   * Draws the primary button at the left and Cancel at the right, for a confirmation that changes or
   * deletes records. They sit in that order in the DOM too, so Tab moves through them the way they are
   * drawn, and the dialog opens on Cancel so a stray Enter cancels rather than writes
   */
  primaryOnLeft?: boolean

  /** Draws the primary action red, for a submission that removes something */
  tone?: 'primary' | 'danger'

  /**
   * Every label the primary button can show, for one whose label changes while the modal is open. The
   * labels fade into each other and the button's width eases between them, in place of `submitWidthClassName`
   * and a snap. Left out by a button with one label
   */
  submitLabels?: readonly string[]
}

/**
 * Cancel and submit actions for a modal form, with the submission's own error message beside them.
 * In the row the buttons wider screens get, the buttons keep their width and the message wraps
 * in the space left beside them
 */
export function ModalFormFooter({
  submitLabel,
  submitDisabled,
  submitBlockedReason,
  cancelDisabled = submitDisabled,
  submitReason = null,
  submitReasonShownById,
  submitWidthClassName,
  error,
  errorId,
  level = 'page',
  onCancel,
  cancelLabel = 'Cancel',
  onPrimary,
  primaryOnLeft = false,
  tone = 'primary',
  submitLabels,
}: ModalFormFooterProps) {
  const primaryRef = useRef<HTMLButtonElement | null>(null)
  const fitted = useFittedButtonWidth(submitLabels ?? submitLabel)
  const { buttonRef: fittedRef } = fitted
  const setPrimary = useCallback(
    (node: HTMLButtonElement | null) => {
      primaryRef.current = node
      fittedRef.current = node
    },
    [fittedRef],
  )
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
      className="app-secondary-button w-full shrink-0 sm:w-auto"
      onClick={onCancel}
      disabled={cancelDisabled}
      data-modal-initial-focus={primaryOnLeft ? 'true' : undefined}
    >
      {cancelLabel}
    </button>
  )
  const primaryButton = (
    <DisabledReasonButton
      ref={setPrimary}
      style={submitLabels ? fitted.style : undefined}
      type={onPrimary ? 'button' : 'submit'}
      onClick={() => {
        primaryHadFocus.current = true
        onPrimary?.()
      }}
      // A reason keeps the button focusable so it can be read, refusing presses itself
      disabled={submitDisabled}
      disabledReason={submitDisabled ? undefined : (submitReason ?? submitBlockedReason)}
      reasonShownById={submitReason ? submitReasonShownById : undefined}
      aria-busy={submitDisabled}
      className={`${tone === 'danger' ? 'app-danger-button' : 'app-primary-button'} shrink-0${submitLabels ? ' relative' : ''}${submitDisabled ? ' app-primary-button-loading justify-self-center sm:justify-self-auto' : ` ${submitLabels ? 'w-full sm:w-(--fit-width)' : submitWidthClassName}`}`}
    >
      {/* The spinner replaces the label, so it carries the label as its own name and a screen reader still
          says which action is in flight */}
      {submitLabels && fitted.measure}
      <PendingLabel pending={submitDisabled} name={submitLabel}>
        {submitLabels ? (
          <span className="grid">
            {submitLabels.map((label) => (
              <span
                key={label}
                aria-hidden={label !== submitLabel}
                className="col-start-1 row-start-1 flex items-center justify-center transition-opacity motion-reduce:transition-none"
                style={{ opacity: label === submitLabel ? 1 : 0 }}
              >
                {label}
              </span>
            ))}
          </span>
        ) : (
          submitLabel
        )}
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
          {cancelButton}
        </>
      ) : (
        <>
          {errorMessage}
          {cancelButton}
          {primaryButton}
        </>
      )}
    </div>
  )
}
