import { AuthErrorBanner } from '@/pages/auth/components/feedback/ErrorBanner'
import { CurrencyRetryAction } from '@/components/currency/CurrencyRetryAction'
import { useCurrencyRetry } from '@/hooks/useCurrencyRetry'

interface CurrencyRetryWarningProps {
  failed: boolean
  fetching: boolean
  onRetry: () => Promise<unknown>
}

/** Keeps a failed currency request recoverable without submitting or resetting the signup form */
export function CurrencyRetryWarning({ failed, fetching, onRetry }: CurrencyRetryWarningProps) {
  const { retrying, handleRetry } = useCurrencyRetry(fetching, onRetry)

  // Keep the banner mounted so its presence boundary can finish the exit animation
  const visible = failed || retrying

  return (
    <AuthErrorBanner
      error={visible ? (
        <>
          Unable to load currencies.{' '}
          <CurrencyRetryAction retrying={retrying} fetching={fetching} onRetry={handleRetry} />
        </>
      ) : null}
    />
  )
}
