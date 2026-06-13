import { useEffect, useRef, useState } from 'react'

const PRIMARY_AMOUNT_MAX_REM = 3
const PRIMARY_AMOUNT_MIN_REM = 1.875

/**
 * Fits the primary period amount into its container without wrapping
 */
export function useFittedPrimaryAmount(value: string) {
  const textRef = useRef<HTMLParagraphElement>(null)
  const [fontSizeRem, setFontSizeRem] = useState(PRIMARY_AMOUNT_MAX_REM)

  useEffect(() => {
    const textElement = textRef.current
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
        measuredTextElement.style.fontSize = `${PRIMARY_AMOUNT_MAX_REM}rem`

        const availableWidth = measuredTextElement.clientWidth
        const requiredWidth = measuredTextElement.scrollWidth

        measuredTextElement.style.fontSize = previousFontSize

        const nextFontSize =
          availableWidth > 0 && requiredWidth > availableWidth
            ? Math.max(PRIMARY_AMOUNT_MIN_REM, PRIMARY_AMOUNT_MAX_REM * (availableWidth / requiredWidth))
            : PRIMARY_AMOUNT_MAX_REM

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
  }, [value])

  return [textRef, fontSizeRem, PRIMARY_AMOUNT_MAX_REM] as const
}
