import ActionFeedbackButton, { type ActionFeedbackStatus } from '@/components/feedback/ActionButton'
import { DisabledReasonButton } from '@/components/tooltips/DisabledReasonButton'

type SettingsPaneActionsProps = {
  canSave: boolean
  dirty: boolean
  error?: string | null
  onDiscard: () => void
  onSave: () => void
  pending: boolean
  status: ActionFeedbackStatus
}

/**
 * Renders the shared settings pane save, discard, and error controls
 */
export function SettingsPaneActions({
  canSave,
  dirty,
  error,
  onDiscard,
  onSave,
  pending,
  status,
}: SettingsPaneActionsProps) {
  // Unchanged is the common case. A changed pane that still can't save has a field to put right
  const saveBlockedReason = dirty ? 'Complete the fields above first' : 'There are no changes to save'

  return (
    <div className="space-y-2 border-t pt-4" style={{ borderColor: 'var(--app-border)' }}>
      {error && (
        <p className="text-sm" style={{ color: 'var(--app-negative)' }}>
          {error}
        </p>
      )}
      <div className="flex items-center justify-between gap-2">
        <DisabledReasonButton
          className="app-secondary-button"
          onClick={onDiscard}
          disabled={pending}
          disabledReason={!dirty && !pending ? 'There are no changes to discard' : undefined}
        >
          Discard
        </DisabledReasonButton>
        <ActionFeedbackButton
          type="button"
          className="app-primary-button w-[72px]"
          onClick={onSave}
          disabled={!canSave && status === 'idle'}
          disabledReason={!canSave && status === 'idle' && !pending ? saveBlockedReason : undefined}
          loadingLabel="Saving"
          status={status}
        >
          Save
        </ActionFeedbackButton>
      </div>
    </div>
  )
}
