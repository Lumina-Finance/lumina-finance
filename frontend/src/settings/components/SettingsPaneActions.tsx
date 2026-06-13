import ActionFeedbackButton, { type ActionFeedbackStatus } from '@/components/ActionFeedbackButton'

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
  return (
    <div className="space-y-2 border-t pt-4" style={{ borderColor: 'var(--app-border)' }}>
      {error && (
        <p className="text-sm" style={{ color: 'var(--app-negative)' }}>
          {error}
        </p>
      )}
      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          className="app-secondary-button"
          onClick={onDiscard}
          disabled={!dirty || pending}
        >
          Discard
        </button>
        <ActionFeedbackButton
          type="button"
          className="app-primary-button w-[72px]"
          onClick={onSave}
          disabled={!canSave && status === 'idle'}
          loadingLabel="Saving"
          status={status}
        >
          Save
        </ActionFeedbackButton>
      </div>
    </div>
  )
}
