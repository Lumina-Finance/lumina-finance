import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react'
import { motion, useReducedMotion } from 'motion/react'

type AppScrambledNumberProps = {
  text: string
  loading?: boolean
  loadingText?: string
  className?: string
  style?: CSSProperties

  // The width in pixels the number may take, above which its font size steps down to fit
  maxWidth?: number
}

const SCRAMBLE_INTERVAL_MS = 52
const SETTLE_MS = 420

// How much of its size a number that doesn't fit gives up per pass
const FIT_STEP = 0.01
const widthTransition = { duration: 0.3, ease: [0.16, 1, 0.3, 1] } as const
const settleTransition = { duration: 0.24, ease: [0.16, 1, 0.3, 1] } as const

function scrambleDigits(template: string) {
  return template.replace(/\d/g, () => String(Math.floor(Math.random() * 10)))
}

/**
 * Displays a numeric value that briefly scrambles its digits before settling on the new text whenever
 * the text or loading state changes after the first render, and keeps scrambling continuously while
 * `loading` stays true
 *
 * Animates its width between the loading text and the final text as `loading` toggles, and skips the
 * scramble and width animation entirely when the user prefers reduced motion
 *
 * Given a `maxWidth`, shrinks the font size until the whole text fits, since the box clips what
 * overflows it and a money amount must never lose a digit
 */
export function AppScrambledNumber({
  text,
  loading = false,
  loadingText,
  className,
  style,
  maxWidth,
}: AppScrambledNumberProps) {
  const shouldReduceMotion = useReducedMotion()
  const measureRef = useRef<HTMLSpanElement>(null)
  const mountedRef = useRef(false)
  const widthText = loading ? loadingText ?? text : text
  const [displayText, setDisplayText] = useState(text)
  const [targetWidth, setTargetWidth] = useState<number>()
  const [scrambling, setScrambling] = useState(false)
  const [fitScale, setFitScale] = useState(1)
  const fitScaleRef = useRef(1)

  // The text's width follows the font size only roughly, since browsers round glyph widths, and it
  // changes again when the page's font arrives. So a new text or width starts from the proportional
  // scale and every pass after it, each time the measured width changes, steps down until the text
  // fits. The scale rounds down so rounding never adds a pixel
  const fitInputsRef = useRef('')
  useLayoutEffect(() => {
    const element = measureRef.current
    if (!element || maxWidth === undefined) return

    const measuredWidth = element.getBoundingClientRect().width
    const fullWidth = measuredWidth / fitScaleRef.current
    const proportionalScale = fullWidth > 0 ? Math.min(1, Math.floor((maxWidth / fullWidth) * 100) / 100) : 1
    const inputs = `${maxWidth}|${widthText}`
    const inputsChanged = inputs !== fitInputsRef.current
    fitInputsRef.current = inputs

    let nextScale = fitScaleRef.current
    if (inputsChanged) nextScale = proportionalScale
    else if (measuredWidth > maxWidth) nextScale = Math.min(proportionalScale, Math.round((nextScale - FIT_STEP) * 100) / 100)
    if (nextScale === fitScaleRef.current) return

    fitScaleRef.current = nextScale
    setFitScale(nextScale)
  }, [fitScale, maxWidth, targetWidth, widthText])

  useLayoutEffect(() => {
    const element = measureRef.current
    if (!element) return

    const observer = new ResizeObserver(([entry]) => {
      setTargetWidth(entry.contentRect.width)
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    if (shouldReduceMotion) {
      mountedRef.current = true
      return
    }

    const hasMounted = mountedRef.current
    mountedRef.current = true

    if (!hasMounted && !loading) return

    let interval: number | undefined
    let settleTimeout: number | undefined
    const kickoffTimeout = window.setTimeout(() => {
      if (loading) {
        const template = loadingText ?? text
        setScrambling(true)
        setDisplayText(scrambleDigits(template))
        interval = window.setInterval(() => {
          setDisplayText(scrambleDigits(template))
        }, SCRAMBLE_INTERVAL_MS)
        return
      }

      setScrambling(true)
      setDisplayText(scrambleDigits(text))
      interval = window.setInterval(() => {
        setDisplayText(scrambleDigits(text))
      }, SCRAMBLE_INTERVAL_MS)
      settleTimeout = window.setTimeout(() => {
        if (interval !== undefined) {
          window.clearInterval(interval)
        }
        setDisplayText(text)
        setScrambling(false)
      }, SETTLE_MS)
    }, 0)

    return () => {
      window.clearTimeout(kickoffTimeout)
      if (interval !== undefined) {
        window.clearInterval(interval)
      }
      if (settleTimeout !== undefined) {
        window.clearTimeout(settleTimeout)
      }
    }
  }, [loading, loadingText, shouldReduceMotion, text])

  const visibleText = shouldReduceMotion ? text : displayText
  const isScrambling = shouldReduceMotion ? false : scrambling

  return (
    <motion.span
      className={`relative inline-block overflow-hidden align-bottom ${className ?? ''}`}
      style={fitScale < 1 ? { ...style, fontSize: `${fitScale}em` } : style}
      animate={targetWidth === undefined ? undefined : { width: targetWidth }}
      transition={shouldReduceMotion ? { duration: 0 } : widthTransition}
      aria-busy={loading || isScrambling}    >
      <span className="invisible block whitespace-nowrap" aria-hidden>
        {widthText}
      </span>
      <span
        ref={measureRef}
        className="absolute left-0 top-0 invisible whitespace-nowrap"
        aria-hidden
      >
        {widthText}
      </span>
      <motion.span
        className="absolute left-0 top-0 whitespace-nowrap"
        aria-hidden
        animate={{
          filter: isScrambling ? 'blur(0.35px)' : 'blur(0px)',
        }}
        transition={settleTransition}
      >
        {visibleText}
      </motion.span>
      <span className="sr-only">{loading ? 'Loading' : text}</span>
    </motion.span>
  )
}
