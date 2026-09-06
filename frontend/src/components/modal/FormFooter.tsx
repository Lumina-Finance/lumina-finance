import type { ModalLevel } from '@/components/modal/Shell'

// The stacked level is the narrower panel, so its actions sit tighter to the edge to match its body
// padding. The justify side is applied separately below, since a footer drawn with the primary on
// the left swaps it for sm:justify-between rather than adding to it
const FOOTER_BASE_CLASS_NAME = {
  page: 'grid shrink-0 grid-cols-2 gap-3 px-6 py-4 sm:flex sm:px-8 min-[1050px]:py-5',
  stacked: 'grid shrink-0 grid-cols-2 gap-3 px-6 py-4 sm:flex sm:px-7 min-[1050px]:py-5',
} as const

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
   * Draws the primary button at the left and Cancel at the right by CSS order, with Cancel staying
   * first in the DOM so it is still the first stop after the close button on a Tab
   */
  primaryOnLeft?: boolean
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
}: ModalFormFooterProps) {
  return (
    <div
      className={`${FOOTER_BASE_CLASS_NAME[level]} ${primaryOnLeft ? 'sm:justify-between' : 'sm:justify-end'} ${error ? 'items-center' : ''}`}
      style={{ borderTop: '1px solid var(--app-border)' }}
    >
      {error && (
        <p
          className={`col-span-2 text-sm font-medium sm:col-span-1 ${primaryOnLeft ? 'order-2' : 'sm:mr-auto'}`}
          role="alert"
          style={{ color: 'var(--app-negative)' }}
        >
          {error}
        </p>
      )}
      <button
        type="button"
        className={`app-secondary-button w-full sm:w-auto ${primaryOnLeft ? 'order-3' : ''}`}
        onClick={onCancel}
        disabled={submitDisabled}
      >
        Cancel
      </button>
      <button
        type={onPrimary ? 'button' : 'submit'}
        onClick={onPrimary}
        disabled={submitDisabled}
        className={`app-primary-button overflow-hidden whitespace-nowrap duration-300 ${primaryOnLeft ? 'order-1' : ''} ${submitDisabled ? 'app-primary-button-loading justify-self-center sm:justify-self-auto' : submitWidthClassName}`}
      >
        {/* The spinner replaces the label, so it carries the label as its own name and a screen reader still
            says which action is in flight */}
        {submitDisabled ? <div className="app-spinner" aria-label={submitLabel} /> : submitLabel}
      </button>
    </div>
  )
}
