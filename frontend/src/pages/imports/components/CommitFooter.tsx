import { useId } from 'react'
import { DisabledReasonButton } from '@/components/tooltips/DisabledReasonButton'

/** A check the server runs before the import can be committed, which holds the button while it runs or has failed */
export interface ImportCommitCheck {
  state: 'running' | 'failed'
  message: string

  /** Asks the server again, shown beside a failed check */
  onRetry: () => void
}

const COMMIT_LABELS = ['Commit import', 'Imported'] as const

/**
 * The button's text, which fades from one label to the other when an undo reopens a finished import
 *
 * Both labels sit in one grid cell, so the button keeps the width of the longer one in either state
 * and its edge never jumps. The one not shown is hidden from assistive technology, so the button is
 * named by the label it shows
 */
function CommitLabel({ imported }: { imported: boolean }) {
  const shown = imported ? 'Imported' : 'Commit import'
  return (
    <span className="grid">
      {COMMIT_LABELS.map((label) => (
        <span
          key={label}
          aria-hidden={label !== shown}
          className={`col-start-1 row-start-1 text-center transition-opacity motion-reduce:transition-none ${label === shown ? 'opacity-100' : 'opacity-0'}`}
        >
          {label}
        </span>
      ))}
    </span>
  )
}

/**
 * The button that starts an import, with the reason it can't start yet or the reason an attempt came
 * back refused above it
 */
export function ImportCommitFooter({
  buildError = null,
  check = null,
  importError,
  importErrorLang,
  canCommit,
  imported,
  onCommit,
  className,
}: {
  /** The first thing the answers still need, which holds the button until it is settled */
  buildError?: string | null

  /** A check that holds the button once the answers need nothing more, said where a build error would be */
  check?: ImportCommitCheck | null
  importError: string | null

  /** The language of the import error when it is the server's own English rather than the page's */
  importErrorLang?: string
  canCommit: boolean
  imported: boolean
  onCommit: () => void

  /** Spacing classes for where the footer sits */
  className: string
}) {
  const reasonId = useId()
  // The answers come first: a check is said only once they leave nothing to fix
  const shownCheck = buildError ? null : check
  const reason = buildError ?? shownCheck?.message ?? null
  // Only a reason held the button off is printed above it, so only then does that line describe it
  const reasonIsPrinted = !canCommit && !imported && Boolean(reason)

  return (
    <div data-toast-keep-clear className={`flex flex-col items-end gap-3 ${className}`}>
      {buildError && (
        <p
          id={reasonId}
          className="max-w-xl text-pretty text-right text-sm font-medium"
          style={{ color: 'var(--app-negative)' }}
        >
          {buildError}
        </p>
      )}
      {shownCheck?.state === 'running' && (
        <p
          id={reasonId}
          role="status"
          className="max-w-xl text-pretty text-right text-sm font-medium"
          style={{ color: 'var(--app-text-muted)' }}
        >
          {shownCheck.message}
        </p>
      )}
      {shownCheck?.state === 'failed' && (
        <div className="flex flex-wrap items-center justify-end gap-3">
          <p
            id={reasonId}
            role="alert"
            className="max-w-xl text-pretty text-right text-sm font-medium"
            style={{ color: 'var(--app-negative)' }}
          >
            {shownCheck.message}
          </p>
          <button type="button" className="app-secondary-button h-9" onClick={shownCheck.onRetry}>
            Try again
          </button>
        </div>
      )}
      {importError && (
        <p
          role="alert"
          className="max-w-xl text-pretty text-right text-sm font-medium"
          style={{ color: 'var(--app-negative)' }}
        >
          <span lang={importErrorLang}>{importError}</span>
        </p>
      )}
      <DisabledReasonButton
        className="app-primary-button"
        onClick={onCommit}
        disabled={!canCommit}
        disabledReason={canCommit ? undefined : imported ? 'This import is already done' : reason}
        reasonShownById={reasonIsPrinted ? reasonId : undefined}
      >
        <CommitLabel imported={imported} />
      </DisabledReasonButton>
    </div>
  )
}
