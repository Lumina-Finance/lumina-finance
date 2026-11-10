import type { Ref } from 'react'
import { TriangleAlert } from 'lucide-react'

/** A bank read that failed, with what makes that read alone again */
export type BankReadFailure = {
  retry: () => void

  /** The read is being made again */
  isRetrying: boolean
}

/**
 * Says a bank read failed, drawn like the review block's backlog notice, with a retry that makes
 * only that read again
 *
 * The retry stays focusable while it waits, so a keyboard user who pressed it keeps their place
 */
export function ReadFailureNotice({
  subject,
  failure,
  retryRef,
}: {
  /** What failed, as in "Sync pause status" */
  subject: string
  failure: BankReadFailure
  retryRef?: Ref<HTMLButtonElement>
}) {
  return (
    <div
      role="alert"
      className="flex items-center gap-2 rounded-lg py-1 pl-3 pr-1.5 text-xs"
      style={{ background: 'var(--app-negative-soft)', color: 'var(--app-text)' }}
    >
      <TriangleAlert size={14} aria-hidden className="shrink-0" style={{ color: 'var(--app-negative)' }} />
      <span className="min-w-0 flex-1 text-pretty">{subject} could not load.</span>
      <button
        ref={retryRef}
        type="button"
        onClick={() => {
          if (!failure.isRetrying) failure.retry()
        }}
        aria-disabled={failure.isRetrying}
        aria-busy={failure.isRetrying}
        className="min-h-6 shrink-0 rounded-md px-1.5 font-medium underline underline-offset-2 transition-colors hover:bg-[var(--app-accent-soft)] focus-visible:bg-transparent! focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--app-accent-nav-focus-border)] aria-disabled:cursor-default motion-reduce:transition-none"
      >
        {failure.isRetrying ? 'Retrying…' : 'Try again'}
      </button>
    </div>
  )
}
