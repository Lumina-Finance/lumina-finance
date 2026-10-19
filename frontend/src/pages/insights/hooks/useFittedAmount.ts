import { useEffect, useState, type CSSProperties } from 'react'

/**
 * Shrinks a headline amount, which never wraps, until it fits its container's width
 *
 * The text keeps its class's font size, `maxRem`, while it fits, and the returned style is undefined
 * then. A total too long even at `minRem` stays on one line at that size
 */
export function useFittedAmount(value: string, maxRem: number, minRem: number) {
  // A callback ref held in state, so the fitting follows the element as it mounts and unmounts
  // (the Net Cash Flow headline is absent while its load has failed)
  const [textElement, setTextElement] = useState<HTMLParagraphElement | null>(null)
  const [fontSizeRem, setFontSizeRem] = useState(maxRem)

  useEffect(() => {
    const containerElement = textElement?.parentElement
    if (!textElement || !containerElement) return undefined
    const measuredTextElement = textElement

    let frameId = 0
    let cancelled = false

    /**
     * Re-measures from the largest allowed size so a previously reduced value can grow again
     */
    function measure() {
      window.cancelAnimationFrame(frameId)
      frameId = window.requestAnimationFrame(() => {
        if (cancelled) return

        const previousFontSize = measuredTextElement.style.fontSize
        measuredTextElement.style.fontSize = `${maxRem}rem`

        const availableWidth = measuredTextElement.clientWidth
        const requiredWidth = measuredTextElement.scrollWidth

        measuredTextElement.style.fontSize = previousFontSize

        const nextFontSize =
          availableWidth > 0 && requiredWidth > availableWidth
            ? Math.max(minRem, maxRem * (availableWidth / requiredWidth))
            : maxRem

        setFontSizeRem((currentFontSize) =>
          Math.abs(currentFontSize - nextFontSize) < 0.02 ? currentFontSize : nextFontSize,
        )
      })
    }

    measure()
    document.fonts?.ready.then(measure)

    if (typeof ResizeObserver === 'undefined') {
      return () => {
        cancelled = true
        window.cancelAnimationFrame(frameId)
      }
    }

    const resizeObserver = new ResizeObserver(measure)
    resizeObserver.observe(containerElement)

    return () => {
      cancelled = true
      window.cancelAnimationFrame(frameId)
      resizeObserver.disconnect()
    }
  }, [textElement, value, maxRem, minRem])

  const style: CSSProperties | undefined = fontSizeRem < maxRem ? { fontSize: `${fontSizeRem}rem` } : undefined
  return [setTextElement, style] as const
}
