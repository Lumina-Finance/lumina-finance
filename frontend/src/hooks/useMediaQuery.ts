import { useSyncExternalStore } from 'react'

/**
 * Whether a CSS media query matches right now, following it as the window changes
 *
 * @param query A media query such as `(min-width: 750px)`
 */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const list = window.matchMedia(query)
      list.addEventListener('change', onChange)
      return () => list.removeEventListener('change', onChange)
    },
    () => window.matchMedia(query).matches,
    () => false,
  )
}
