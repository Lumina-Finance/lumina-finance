import { MODAL_INSET_CLASS_NAME } from '@/components/modal/inset'
import type { ModalLevel } from '@/components/modal/Shell'
import { DisabledReasonButton } from '@/components/tooltips/DisabledReasonButton'

// Cancel and the main action as two equal halves below sm and together on the right from it, the same
// for adding and editing a budget
const FOOTER_CLASS_NAME = 'grid shrink-0 grid-cols-2 gap-3 py-4 sm:flex sm:justify-end min-[1050px]:py-5'

interface BudgetEditorModalFooterProps {
  // The modal level the footer sits in, which sets how far its edges are inset
  level: ModalLevel
  isPending: boolean
  submitDisabled: boolean
  // Why Save is held off by the form, shown in a tooltip while the button stays focusable
  submitDisabledReason?: string
  submitLabel: string
  onClose: () => void
}

/**
 * Renders shared budget form actions with the pending-state spinner treatment
 */
export default function BudgetEditorModalFooter({
  level,
  isPending,
  submitDisabled,
  submitDisabledReason,
  submitLabel,
  onClose,
}: BudgetEditorModalFooterProps) {
  return (
    <div
      className={`${FOOTER_CLASS_NAME} ${MODAL_INSET_CLASS_NAME[level]}`}
      style={{ borderTop: '1px solid var(--app-border)' }}
    >
      <button type="button" className="app-secondary-button w-full sm:w-auto" onClick={onClose} disabled={isPending}>
        Cancel
      </button>
      <DisabledReasonButton
        type="submit"
        data-testid="budget-submit"
        aria-label={submitLabel}
        aria-busy={isPending}
        className={`app-primary-button overflow-hidden whitespace-nowrap${isPending ? ' app-primary-button-loading justify-self-center sm:justify-self-auto' : ' w-full sm:w-36'}`}
        disabled={submitDisabled}
        disabledReason={submitDisabled ? undefined : submitDisabledReason}
      >
        {isPending ? <div className="app-spinner" /> : submitLabel}
      </DisabledReasonButton>
    </div>
  )
}
