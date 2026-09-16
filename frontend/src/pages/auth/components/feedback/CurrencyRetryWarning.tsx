import { useState } from 'react'
import { AuthErrorBanner } from '@/pages/auth/components/feedback/ErrorBanner'

interface CurrencyRetryWarningProps {
  failed: boolean
  fetching: boolean
  onRetry: () => Promise<unknown>
}

/** Keeps a failed currency request recoverable without submitting or resetting the signup form */
export function CurrencyRetryWarning({ failed, fetching, onRetry }: CurrencyRetryWarningProps) {
  const [retrying, setRetrying] = useState(false)

  /** Keeps the control visible while the query changes from failed to pending */
  const handleRetry = async () => {
    if (fetching || retrying) return
    setRetrying(true)
    try {
      await onRetry()
    } finally {
      setRetrying(false)
    }
  }

  if (!failed && !retrying) return null

  return (
    <AuthErrorBanner
      error={
        <>
          Unable to load currencies.{' '}
          {retrying ? (
            <span role="status" className="inline-flex items-center gap-1.5 align-middle">
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
        </>
      }
    />
  )
}
