import { MODAL_INSET_CLASS_NAME } from '@/components/modal/inset'
import type { ModalLevel } from '@/components/modal/Shell'

// The justify side is applied separately below, since a footer drawn with the primary on the left
// swaps it for sm:justify-between rather than adding to it
const FOOTER_BASE_CLASS_NAME = 'grid shrink-0 grid-cols-2 gap-3 py-4 sm:flex min-[1050px]:py-5'

interface ModalFormFooterProps {
  submitLabel: string
  /** Held down while the submission is in flight, which swaps the label for a spinner and blocks cancelling */
  submitDisabled: boolean
  /** Width classes for the submit button, so a short label does not stretch the whole way across */
  submitWidthClassName: string
  /** Shown beside the actions when the submission failed, rather than against any one field */
  error?: string | null
  level?: ModalLevel
  onCancel: () => void

  /** Runs the primary action directly and renders it as a plain button, for a panel with nothing to submit */
  onPrimary?: () => void

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
  submitWidthClassName,
  error,
  level = 'page',
  onCancel,
  onPrimary,
  primaryOnLeft = false,
  tone = 'primary',
}: ModalFormFooterProps) {
  // Below sm an error between the buttons would split them across rows, so it is drawn first on a row of
  // its own, while it stays between them in the DOM and in the single row from sm
  const errorMessage = error && (
    <p
      className={`col-span-2 text-sm font-medium sm:col-span-1 ${primaryOnLeft ? 'order-first sm:order-none' : 'sm:mr-auto'}`}
      role="alert"
      style={{ color: 'var(--app-negative)' }}
    >
      {error}
    </p>
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
  const primaryButton = (
    <button
      type={onPrimary ? 'button' : 'submit'}
      onClick={onPrimary}
      disabled={submitDisabled}
      aria-busy={submitDisabled}
      className={`${tone === 'danger' ? 'app-danger-button' : 'app-primary-button'} overflow-hidden whitespace-nowrap duration-300 ${submitDisabled ? 'app-primary-button-loading justify-self-center sm:justify-self-auto' : submitWidthClassName}`}
    >
      {/* The spinner replaces the label, so it carries the label as its own name and a screen reader still
          says which action is in flight */}
      {submitDisabled ? <div className="app-spinner" aria-label={submitLabel} /> : submitLabel}
    </button>
  )

  return (
    <div
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
