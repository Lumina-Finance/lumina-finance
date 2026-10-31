/**
 * Renders the account's notes under its facts, keeping the line breaks the owner typed
 *
 * Long notes scroll inside their own box, so the box takes keyboard focus and is named by its label
 */
export function IdentityNotes({ notes }: { notes: string }) {
  return (
    <div className="mt-3 min-w-0">
      <p id="account-notes-label" className="text-xs font-medium uppercase" style={{ color: 'var(--app-text-subtle)' }}>
        Notes
      </p>
      <p
        role="region"
        aria-labelledby="account-notes-label"
        tabIndex={0}
        className="mt-0.5 max-h-24 overflow-y-auto whitespace-pre-wrap break-words rounded text-sm"
      >
        {notes}
      </p>
    </div>
  )
}
