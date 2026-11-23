import { DisabledReasonButton } from '@/components/tooltips/DisabledReasonButton'

interface DeleteProfileCardProps {
  onDelete: () => void
  /** Why the deletion can't start, such as an account with no way to confirm it's them */
  blockedReason?: string
  /** True while the browser leaves for a sign-in provider to confirm it's the user */
  leaving: boolean
  /** What went wrong finishing a deletion after a provider sign-in */
  error: string | null
}

/**
 * The Delete profile section at the very bottom of Settings, below every other section. It sits
 * apart from every editable field, so a stray press while editing can't reach it, and its button
 * stays quiet until the pointer or keyboard focus reaches it
 */
export default function DeleteProfileCard({ onDelete, blockedReason, leaving, error }: DeleteProfileCardProps) {
  return (
    <section id="delete-profile">
      {/* The panel's line says what the section does, so the heading stands alone */}
      <div className="app-section-header">
        <h2 className="app-section-title">Delete profile</h2>
      </div>
      <div
        className="min-w-0 rounded-2xl border p-4"
        style={{ background: 'var(--app-negative-soft)', borderColor: 'var(--app-negative-border)' }}
      >
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm" style={{ color: 'var(--app-text-muted)' }}>
            This will permanently delete all your data and is irrevocable.
          </p>
          <DisabledReasonButton
            className="app-danger-button app-danger-button-quiet shrink-0 self-start sm:self-auto"
            disabledReason={blockedReason}
            disabled={leaving}
            onClick={onDelete}
          >
            {leaving ? "Confirming it's you" : 'Delete profile'}
          </DisabledReasonButton>
        </div>
        {error && (
          <p role="alert" className="mt-3 text-sm" style={{ color: 'var(--app-negative)' }}>
            {error}
          </p>
        )}
      </div>
    </section>
  )
}
