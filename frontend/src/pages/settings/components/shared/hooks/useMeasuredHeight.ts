import { useLayoutEffect, useRef, useState, type RefObject } from 'react'

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

    let frameId: number | null = null
    const updateHeight = () => {
      if (frameId !== null) window.cancelAnimationFrame(frameId)
      frameId = window.requestAnimationFrame(() => {
        frameId = null
        setHeight(element.getBoundingClientRect().height)
      })
    }

    updateHeight()
    const observer = new ResizeObserver(updateHeight)
    observer.observe(element)

    return () => {
      if (frameId !== null) window.cancelAnimationFrame(frameId)
      observer.disconnect()
    }
  }, [])

  return { ref, height }
}
