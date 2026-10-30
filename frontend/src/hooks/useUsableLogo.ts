import { useState } from 'react'

// Logos that failed to load, kept for the page's life so a row that remounts does not draw one again
const droppedLogoUrls = new Set<string>()

/**
 * Drops a logo that fails to load, so the caller draws its own tile in place of a broken image.
 * Returns the source to draw, null once dropped, and the handlers to put on the image
 */
export function useUsableLogo(src: string | null | undefined) {
  const [, setDroppedCount] = useState(0)
  const drop = () => {
    if (!src) return
    droppedLogoUrls.add(src)
    setDroppedCount((count) => count + 1)
  }

  return {
    src: src && !droppedLogoUrls.has(src) ? src : null,
    imageProps: { onError: drop },
  }
}
