import { ApiError, MAINTENANCE_MESSAGE } from '@/api/auth'
import { SERVER_UNREACHABLE_MESSAGE } from '@/api/server'
import { useServerNotice } from '@/api/version'
import FailureBlock from '@/components/errors/FailureBlock'
import { useServerReachability } from '@/hooks/useServerReachability'

const MAINTENANCE_HEADING = "We'll be back soon"

export type FallbackVariant = 'card' | 'screen'

interface FallbackProps {
  componentStack: string | null
  error: unknown

  // Keeps the reload from emptying this browser's storage. Set it where the failure is known to be a
  // network one, since the wipe exists to clear state that could have caused a render error, and it
  // otherwise takes the theme, the sidebar width and the whole cached query data with it for nothing
  preserveStoredData?: boolean

  variant: FallbackVariant
}

/**
 * The recovery screen shown in place of whatever failed to render
 *
 * The card variant sits in the page area with the navigation still beside it, the screen variant
 * stands alone when there is no app left around it. Both carry the same message and actions, since
 * from the user's side the difference is only how much of the app is still there
 */
export default function Fallback({ componentStack, error, preserveStoredData = false, variant }: FallbackProps) {
  // Until the probe comes back the message assumes a bug, since that is the only thing the user
  // can act on. An unreachable server rewrites it rather than the other way round
  const serverUnreachable = useServerReachability() === 'unreachable'

  // A server in maintenance is no bug and no unreachable server. That holds when its answer carries the
  // maintenance marker, and when the maintenance file reports it for a request the server never answered
  const notice = useServerNotice()
  const isUnanswered =
    (error instanceof TypeError && error.message === SERVER_UNREACHABLE_MESSAGE) ||
    (error instanceof DOMException && error.name === 'TimeoutError')
  const isMaintenance = (error instanceof ApiError && error.isMaintenance) || (isUnanswered && notice === 'maintenance')

  const content = (
    <FailureBlock
      componentStack={componentStack}
      detail={isMaintenance ? MAINTENANCE_MESSAGE : null}
      error={error}
      // The last word and the face are held together, or a narrow screen breaks between them and
      // leaves the bracket opening the next line as stray punctuation
      heading={
        isMaintenance ? (
          MAINTENANCE_HEADING
        ) : (
          <>
            OK this was not in the{' '}
            <span className="whitespace-nowrap">
              plan <span aria-hidden>:(</span>
            </span>
          </>
        )
      }
      preserveStoredData={preserveStoredData}
      serverUnreachable={serverUnreachable && !isMaintenance}
      size={variant}
    />
  )

  if (variant === 'screen') {
    return (
      <div
        className="flex min-h-[100dvh] items-center justify-center px-4"
        style={{ backgroundColor: 'var(--app-bg)' }}
      >
        <div className="w-full max-w-md">{content}</div>
      </div>
    )
  }

  return (
    // The page area is taller than the card, so the height gives it something to sit in the middle
    // of rather than hugging the top of the content column
    <div className="flex min-h-[70dvh] items-center justify-center">
      <div
        className="w-full max-w-md rounded-2xl border p-6"
        style={{ backgroundColor: 'var(--app-surface-soft)', borderColor: 'var(--app-border)' }}
      >
        {content}
      </div>
    </div>
  )
}
