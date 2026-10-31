import { useEffect, useSyncExternalStore } from 'react'
import { createLogoRetryStore } from '@/utils/logoRetryStore'

// Shared by every logo on the page, so a failure shows the placeholder everywhere the logo appears
// and a retry draws it everywhere
const logoStore = createLogoRetryStore(() => navigator.onLine)

// A connection that returns or a page shown again is when a failed logo is likely to load
if (typeof window !== 'undefined') {
  window.addEventListener('online', logoStore.retryAll)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') logoStore.retryAll()
  })
}

/**
 * Drops a logo that fails to load, so the caller draws its own tile in place of a broken image, and
 * draws it again when a row mounts, the connection returns or the page is shown again, up to a few failures.
 * Returns the source to draw, null while dropped, and the handlers to put on the image
 */
export function useUsableLogo(src: string | null | undefined) {
  const isDropped = useSyncExternalStore(
    logoStore.subscribe,
    () => (src ? logoStore.isDropped(src) : false),
    () => false,
  )

  useEffect(() => {
    if (src) logoStore.retry(src)
  }, [src])

  return {
    src: src && !isDropped ? src : null,
    imageProps: {
      onError: () => {
        if (src) logoStore.fail(src)
      },
      onLoad: () => {
        if (src) logoStore.succeed(src)
      },
    },
  }
}
