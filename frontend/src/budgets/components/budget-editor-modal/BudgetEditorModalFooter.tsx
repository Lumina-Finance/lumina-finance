interface BudgetEditorModalFooterProps {
  className: string
  isPending: boolean
  submitDisabled: boolean
  submitLabel: string
  onClose: () => void
}

/**
 * Renders shared budget form actions with the pending-state spinner treatment
 */
export default function BudgetEditorModalFooter({
  className,
  isPending,
  submitDisabled,
  submitLabel,
  onClose,
}: BudgetEditorModalFooterProps) {
  return (
    <div
      className={className}
      style={{ borderTop: '1px solid var(--app-border)' }}
    >
      <button type="button" className="app-secondary-button w-full sm:w-auto" onClick={onClose} disabled={isPending}>
        Cancel
      </button>
      <button
        type="submit"
        className={`app-primary-button overflow-hidden whitespace-nowrap duration-300 ${isPending ? 'app-primary-button-loading justify-self-center sm:justify-self-auto' : 'w-full sm:w-36'}`}
        disabled={submitDisabled}
      >
        {isPending ? <div className="app-spinner" /> : submitLabel}
      </button>
    </div>
  )
}
