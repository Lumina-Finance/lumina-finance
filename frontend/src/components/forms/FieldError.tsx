import { AnimatePresence, motion } from 'motion/react'
import { joinClassNames } from '@/utils/classNames'

interface FieldErrorProps {
  /** The problem with the field, or nothing while the field is fine. A changed message replaces the old one */
  message?: string | false | null
  /** Lets the field point to the message as its description */
  id?: string
  className?: string
  /** Grows and shrinks the message's own height as it comes and goes, without the sideways slide, for a heading row that gets taller when the message wraps */
  collapse?: boolean
  /** Fades a message out before the one replacing it fades in, so the two never share the row, since they would wrap it or cross */
  sequential?: boolean
  /** Called once a message that was shown has finished leaving */
  onExitComplete?: () => void
}

/**
 * The message a field shows when its input is missing or wrong, drawn on the field's label row and
 * fading in from the right, which is the one look every dialog's field problems share
 */
export function FieldError({ message, id, className, collapse, sequential, onExitComplete }: FieldErrorProps) {
  // A heading row sits against the clipped edge of its column, so its message grows in place instead of sliding
  const hidden = collapse ? { opacity: 0, height: 0 } : { opacity: 0, x: 4 }
  const shown = collapse ? { opacity: 1, height: 'auto' } : { opacity: 1, x: 0 }
  return (
    <AnimatePresence initial={false} mode={sequential ? 'wait' : 'sync'} onExitComplete={onExitComplete}>
      {message && (
        <motion.p
          key={message}
          id={id}
          role="alert"
          className={joinClassNames('text-right text-xs font-medium leading-5', className)}
          style={{ color: 'var(--app-negative)' }}
          initial={hidden}
          animate={shown}
          exit={hidden}
          transition={{ duration: 0.15 }}
        >
          {message}
        </motion.p>
      )}
    </AnimatePresence>
  )
}
