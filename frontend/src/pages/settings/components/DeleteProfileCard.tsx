/**
 * The Delete profile section at the very bottom of Settings, below every other section. It sits
 * apart from every editable field, so a stray press while editing can't reach it, and its button
 * stays quiet until the pointer or keyboard focus reaches it
 */
export default function DeleteProfileCard({ onDelete }: { onDelete: () => void }) {
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
          <button
            type="button"
            className="app-danger-button app-danger-button-quiet shrink-0 self-start sm:self-auto"
            onClick={onDelete}
          >
            Delete profile
          </button>
        </div>
      </div>
    </section>
  )
}
