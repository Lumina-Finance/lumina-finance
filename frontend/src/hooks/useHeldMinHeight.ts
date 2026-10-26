import { useEffect, useState } from 'react'

/**
 * Keeps an element from ever being shorter than the tallest it has been, so a box sized by its content,
 * such as a dialog around a list, holds its height while a search empties the list
 *
 * Returns the ref to put on the element and the minimum height to put in its style. The element may mount and unmount, as a dialog's
 * content does, and each time it mounts it starts afresh. The height is held until the window is resized,
 * since a window that has shrunk may no longer have the room for it
 */
export function useHeldMinHeight<T extends HTMLElement>() {
  const [element, setElement] = useState<T | null>(null)
  const [minHeight, setMinHeight] = useState<number>()

  useEffect(() => {
    if (!element) return undefined

    const observer = new ResizeObserver(() => {
      // The layout height, which an entrance transform on the dialog does not scale
      const height = element.offsetHeight
      setMinHeight((held) => (held === undefined || height > held ? height : held))
    })
    observer.observe(element)
    const release = () => setMinHeight(undefined)
    window.addEventListener('resize', release)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', release)
      setMinHeight(undefined)
    }
  }, [element])

  return [setElement, minHeight] as const
}
