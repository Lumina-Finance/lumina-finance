import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { useState } from 'react'

const SENT_NOTICE_EASE = [0.22, 1, 0.36, 1] as const

/**
 * The notice that a confirmation email is on its way, easing in and out under the Security card
 *
 * The message goes null the moment the user edits again, so the last one shown stays drawn while the
 * box eases out, and its text fades with the height instead of vanishing in the first frame
 */
export function SentNotice({ message }: { message: string | null }) {
  const shouldReduceMotion = useReducedMotion()
  const [lastMessage, setLastMessage] = useState(message)
  if (message !== null && message !== lastMessage) setLastMessage(message)

  return (
    <AnimatePresence initial={false}>
      {message && (
        <motion.div
          key="email-sent"
          className="overflow-hidden"
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: 'auto', opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          transition={{ duration: shouldReduceMotion ? 0.01 : 0.3, ease: SENT_NOTICE_EASE }}
        >
          {/* The gap above sits inside the box, since padding on a box animating its height would stay behind */}
          <p role="status" className="pt-4 text-sm text-pretty" style={{ color: 'var(--app-text-muted)' }}>
            {message ?? lastMessage}
          </p>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
