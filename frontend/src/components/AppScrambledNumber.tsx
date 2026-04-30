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
    const nextWidth = measureRef.current?.getBoundingClientRect().width
    if (nextWidth !== undefined) {
      setTargetWidth(nextWidth)
    }
  }, [widthText])

  useEffect(() => {
    if (shouldReduceMotion) {
      setDisplayText(text)
      setScrambling(false)
      mountedRef.current = true
      return
    }

    if (!mountedRef.current && !loading) {
      mountedRef.current = true
      setDisplayText(text)
      setScrambling(false)
      return
    }

    mountedRef.current = true

    if (loading) {
      const template = loadingText ?? text
      setScrambling(true)
      setDisplayText(scrambleDigits(template))
      const interval = window.setInterval(() => {
        setDisplayText(scrambleDigits(template))
      }, SCRAMBLE_INTERVAL_MS)
      return () => window.clearInterval(interval)
    }

    setScrambling(true)
    setDisplayText(scrambleDigits(text))
    const interval = window.setInterval(() => {
      setDisplayText(scrambleDigits(text))
    }, SCRAMBLE_INTERVAL_MS)
    const timeout = window.setTimeout(() => {
      window.clearInterval(interval)
      setDisplayText(text)
      setScrambling(false)
    }, SETTLE_MS)

    return () => {
      window.clearInterval(interval)
      window.clearTimeout(timeout)
    }
  }, [loading, loadingText, shouldReduceMotion, text])

  return (
    <motion.span
      className={`relative inline-block overflow-hidden align-bottom ${className ?? ''}`}
      style={style}
      animate={targetWidth === undefined ? undefined : { width: targetWidth }}
      transition={shouldReduceMotion ? { duration: 0 } : widthTransition}
      aria-busy={loading || scrambling}
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
          filter: scrambling ? 'blur(0.35px)' : 'blur(0px)',
        }}
        transition={settleTransition}
      >
        {displayText}
      </motion.span>
      <span className="sr-only">{loading ? 'Loading' : text}</span>
    </motion.span>
  )
}
