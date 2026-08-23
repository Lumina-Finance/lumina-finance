import { ApiError } from '@/api/auth';
import FailureBlock from '@/components/errors/FailureBlock';

// Wide enough for the sentence to break in a readable place, narrow enough that a card has room
// left to centre it in. Below this width the box simply fills what it is given
const STANDALONE_WIDTH_CLASS = 'w-full max-w-sm';

/**
 * Says why part of a working page is missing, in place of an empty state that would otherwise tell
 * the reader there is nothing to show
 *
 * It carries the same wording and the same controls as the crash screen, drawn small enough to sit
 * inside a section or a card. Where the response carried the backend's own explanation, that is
 * quoted instead of the app's general wording
 *
 * @param error - The rejection the query reported, read for the backend's explanation and the status
 * @param standalone - Set where nothing else is left in the card, which sits the box in the middle
 * @param subject - What failed, in the words the page uses for it, as in "Categories" or "Net worth"
 */
export default function LoadFailure({
  className = 'py-3',
  error,
  standalone = false,
  subject,
}: {
  className?: string
  error: unknown
  standalone?: boolean
  subject: string
}) {
  // A request that never reached the server rejects from fetch itself, so nothing is an ApiError,
  // while an ApiError proves the server answered. Reading the distinction off the error is what lets
  // a page carrying eight of these say the right thing without each one probing the server
  const serverAnswered = error instanceof ApiError

  const block = (
    <FailureBlock
      detail={serverAnswered ? error.detail ?? null : null}
      error={error}
      heading={`${subject} could not load`}
      // The failure is a request that failed rather than saved state that broke a render, so
      // wiping this browser's storage would cost the reader their theme, their sidebar width and
      // every cached response for nothing
      preserveStoredData
      serverUnreachable={!serverAnswered}
      size="inline"
    />
  )

  // The wording stays left-aligned, so the width is capped and that capped block is what moves to
  // the middle. A block spanning the whole card would start at the left edge with nothing to centre
  if (standalone) {
    return (
      <div className="flex h-full w-full flex-1 flex-col items-center justify-center py-3" role="alert">
        <div className={STANDALONE_WIDTH_CLASS}>{block}</div>
      </div>
    )
  }

  return (
    <div className={className} role="alert">
      {block}
    </div>
  )
}
