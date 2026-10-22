import { useState, type SyntheticEvent } from 'react'
import { isLogoTooSmall } from '@/utils/institutionLogo'

/**
 * Drops a logo that fails to load or arrives with fewer pixels than the box it fills, so the caller draws
 * its own tile in place of a blurred or broken image. Returns the source to draw, null once dropped,
 * and the handlers to put on the image
 */
export function useUsableLogo(src: string | null | undefined) {
  const [droppedSrc, setDroppedSrc] = useState<string | null>(null)
  const usable = src && src !== droppedSrc ? src : null

  return {
    src: usable,
    imageProps: {
      onError: () => setDroppedSrc(src ?? null),
      onLoad: (event: SyntheticEvent<HTMLImageElement>) => {
        const image = event.currentTarget
        if (isLogoTooSmall(image.naturalWidth, image.clientWidth, window.devicePixelRatio)) setDroppedSrc(src ?? null)
      },
    },
  }
}
