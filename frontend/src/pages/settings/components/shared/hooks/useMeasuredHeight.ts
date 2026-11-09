import { useLayoutEffect, useRef, useState, type RefObject } from 'react'
import { observeContentHeight } from '@/components/loading/regionHeight'

/**
 * Follows the rendered height of the element the ref is put on, read at most once a frame, so a
 * settings list can animate its wrapper to it as rows come and go. Null until the first reading
 */
export function useMeasuredHeight<T extends HTMLElement>(): { ref: RefObject<T | null>; height: number | null } {
  const ref = useRef<T | null>(null)
  const [height, setHeight] = useState<number | null>(null)

  useLayoutEffect(() => {
    const element = ref.current
    if (!element) return undefined
    return observeContentHeight(element, setHeight, false)
  }, [])

  return { ref, height }
}
