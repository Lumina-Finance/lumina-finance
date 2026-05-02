import { useLayoutEffect, useRef, useState, type CSSProperties } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'

type AppSlotMachineTextProps = {
  text: string
  className?: string
  reserveText?: string
  style?: CSSProperties
}

const slotTransition = { duration: 0.34, ease: [0.16, 1, 0.3, 1] } as const
const widthTransition = { duration: 0.3, ease: [0.16, 1, 0.3, 1] } as const
const slotVariants = {
  initial: { transition: { staggerChildren: 0.018 } },
  enter: { transition: { staggerChildren: 0.018 } },
  exit: { transition: { staggerChildren: 0.014, staggerDirection: -1 } },
} as const

const charVariants = {
  initial: { y: '0.7em', opacity: 0, filter: 'blur(2px)' },
  enter: { y: 0, opacity: 1, filter: 'blur(0px)' },
  exit: { y: '-0.7em', opacity: 0, filter: 'blur(2px)' },
} as const

export function AppSlotMachineText({
  text,
  className,
  reserveText,
  style,
}: AppSlotMachineTextProps) {
  const shouldReduceMotion = useReducedMotion()
  const measureRef = useRef<HTMLSpanElement>(null)
  const widthText = reserveText ?? text
  const [targetWidth, setTargetWidth] = useState<number>()

  useLayoutEffect(() => {
    const element = measureRef.current
    if (!element) return

    const observer = new ResizeObserver(([entry]) => {
      setTargetWidth(entry.contentRect.width)
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  return (
    <motion.span
      className={`relative inline-block overflow-hidden align-bottom ${className ?? ''}`}
      style={style}
      animate={targetWidth === undefined ? undefined : { width: targetWidth }}
      transition={shouldReduceMotion ? { duration: 0 } : widthTransition}
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
      <AnimatePresence initial={false} mode="popLayout">
        <motion.span
          key={text}
          className="absolute left-0 top-0 flex whitespace-nowrap"
          aria-hidden
          initial={shouldReduceMotion ? false : 'initial'}
          animate="enter"
          exit={shouldReduceMotion ? undefined : 'exit'}
          variants={slotVariants}
        >
          {text.split('').map((char, i) => (
            <motion.span
              key={`${text}-${i}`}
              className={char === ' ' ? 'inline-block w-1.5' : 'inline-block'}
              variants={charVariants}
              transition={shouldReduceMotion ? { duration: 0 } : slotTransition}
            >
              {char}
            </motion.span>
          ))}
        </motion.span>
      </AnimatePresence>
      <span className="sr-only">{text}</span>
    </motion.span>
  )
}
