import { useRef, useState } from 'react'
import { LOADING_ANIMATION_MIN_MS, withMinDelay } from '@/utils/timing'

/** Guards repeated clicks and holds the retry feedback through fast responses */
export function useCurrencyRetry(fetching: boolean, onRetry: () => Promise<unknown>) {
  const [retrying, setRetrying] = useState(false)
  const retryPendingRef = useRef(false)

  /** Keeps feedback visible through refetch and guards the outgoing link while it fades away */
  const handleRetry = async () => {
    if (fetching || retryPendingRef.current) return
    retryPendingRef.current = true
    setRetrying(true)
    try {
      await withMinDelay(onRetry, LOADING_ANIMATION_MIN_MS)
    } finally {
      retryPendingRef.current = false
      setRetrying(false)
    }
  }

  return { retrying, handleRetry }
}
