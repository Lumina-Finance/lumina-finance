import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react'
import { motion, useReducedMotion } from 'motion/react'

type AppScrambledNumberProps = {
  text: string
  loading?: boolean
  loadingText?: string
  className?: string
  style?: CSSProperties
}

const SCRAMBLE_INTERVAL_MS = 52
const SETTLE_MS = 420
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
 */
export function AppScrambledNumber({
  text,
  loading = false,
  loadingText,
  className,
  style,
}: AppScrambledNumberProps) {
  const shouldReduceMotion = useReducedMotion()
  const measureRef = useRef<HTMLSpanElement>(null)
  const mountedRef = useRef(false)
  const widthText = loading ? loadingText ?? text : text
  const [displayText, setDisplayText] = useState(text)
  const [targetWidth, setTargetWidth] = useState<number>()
  const [scrambling, setScrambling] = useState(false)

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
      style={style}
      animate={targetWidth === undefined ? undefined : { width: targetWidth }}
      transition={shouldReduceMotion ? { duration: 0 } : widthTransition}
      aria-busy={loading || isScrambling}
    >
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
