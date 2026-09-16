import { useRef, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { LoaderCircle } from 'lucide-react'
import { AuthErrorBanner } from '@/pages/auth/components/feedback/ErrorBanner'
import { withMinDelay } from '@/utils/timing'

/** Keeps the retry feedback visible even when the currency request settles immediately */
const CURRENCY_RETRY_MIN_MS = 800

/** Matches the auth warning fade so its retry states change at the same pace */
const RETRY_FADE_SECONDS = 0.2

interface CurrencyRetryWarningProps {
  failed: boolean
  fetching: boolean
  onRetry: () => Promise<unknown>
}

/** Keeps a failed currency request recoverable without submitting or resetting the signup form */
export function CurrencyRetryWarning({ failed, fetching, onRetry }: CurrencyRetryWarningProps) {
  const [retrying, setRetrying] = useState(false)
  const retryPendingRef = useRef(false)

  /** Keeps feedback visible through refetch and guards the outgoing link while it fades away */
  const handleRetry = async () => {
    if (fetching || retryPendingRef.current) return
    retryPendingRef.current = true
    setRetrying(true)
    try {
      await withMinDelay(onRetry, CURRENCY_RETRY_MIN_MS)
    } finally {
      retryPendingRef.current = false
      setRetrying(false)
    }
  }

  // Keep the banner mounted so its presence boundary can finish the exit animation
  const visible = failed || retrying

  return (
    <AuthErrorBanner
      error={visible ? (
        <>
          Unable to load currencies.{' '}
          <span className="inline-grid align-middle">
            <AnimatePresence initial={false}>
              <motion.span
                key={retrying ? 'retrying' : 'retry'}
                className="inline-block"
                style={{ gridArea: '1 / 1' }}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: RETRY_FADE_SECONDS }}
              >
                {retrying ? (
                  <span role="status" className="flex items-center gap-1.5">
                    <LoaderCircle size={14} className="animate-spin motion-reduce:animate-none" aria-hidden />
                    Retrying…
                  </span>
                ) : (
                  <>
                    Click{' '}
                    <button
                      type="button"
                      disabled={fetching}
                      onClick={handleRetry}
                      aria-label="Retry loading currencies"
                      className="font-medium underline underline-offset-2 disabled:cursor-wait disabled:opacity-50"
                    >
                      here
                    </button>{' '}
                    to retry.
                  </>
                )}
              </motion.span>
            </AnimatePresence>
          </span>
        </>
      ) : null}
    />
  )
}
