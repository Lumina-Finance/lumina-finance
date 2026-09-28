/**
 * The button that starts an import, with the reason it can't start yet or the reason an attempt came
 * back refused above it
 */
export function ImportCommitFooter({
  buildError = null,
  importError,
  canCommit,
  imported,
  onCommit,
  className,
}: {
  /** The first thing the answers still need, which holds the button until it is settled */
  buildError?: string | null
  importError: string | null
  canCommit: boolean
  imported: boolean
  onCommit: () => void

  /** Spacing classes for where the footer sits */
  className: string
}) {
  return (
    <div className={`flex flex-col items-end gap-3 ${className}`}>
      {buildError && (
        <p className="max-w-xl text-right text-sm font-medium" style={{ color: 'var(--app-negative)' }}>
          {buildError}
        </p>
      )}
      {importError && (
        <p role="alert" className="max-w-xl text-right text-sm font-medium" style={{ color: 'var(--app-negative)' }}>
          {importError}
        </p>
      )}
      <button
        type="button"
        className="app-primary-button"
        onClick={onCommit}
        disabled={!canCommit}
      >
        {imported ? 'Imported' : 'Commit import'}
      </button>
    </div>
  )
}
