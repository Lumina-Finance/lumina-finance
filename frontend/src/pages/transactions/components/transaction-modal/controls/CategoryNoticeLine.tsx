import { useState, type ReactNode } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { EASE } from '@/pages/transactions/components/transaction-modal/constants'

type CategoryNoticeLineProps = {
  show: boolean
  children: ReactNode
}

/**
 * One line of explanation under the category dropdown, expanding and collapsing with the choice
 * that produces it
 *
 * The wrapper clips only while its height is moving. Clipping is what lets the height animate
 * without the content spilling, and leaving it on afterwards would cut off a tooltip panel, which
 * is positioned outside the line's own box
 */
export default function CategoryNoticeLine({ show, children }: CategoryNoticeLineProps) {
  // Starts clipped so the first frame of the expansion cannot spill, and goes back to clipped as
  // the collapse begins
  const [clipWhileMoving, setClipWhileMoving] = useState(true)

  return (
    <AnimatePresence initial={false}>
      {show && (
        <motion.div
          key="category-notice-line"
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: 'auto' }}
          exit={{ opacity: 0, height: 0 }}
          transition={{ duration: 0.2, ease: EASE }}
          className={clipWhileMoving ? 'overflow-hidden' : undefined}
          onAnimationStart={() => setClipWhileMoving(true)}
          onAnimationComplete={() => setClipWhileMoving(!show)}
        >
          <div
            className="flex flex-wrap items-center gap-x-2 gap-y-1 px-0.5 pt-2 text-xs leading-5"
            style={{ color: 'var(--app-warning-text)' }}
          >
            {children}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
