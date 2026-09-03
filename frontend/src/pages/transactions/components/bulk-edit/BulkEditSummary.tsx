import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { ArrowRight, Info, TriangleAlert } from 'lucide-react'
import { EASE } from '@/pages/transactions/components/transaction-modal/constants'
import type { BulkEditSummary as BulkEditSummaryResult } from '@/pages/transactions/components/bulk-edit/summary'

interface BulkEditSummaryProps {
  summary: BulkEditSummaryResult
}

/**
 * One line in the animated list, keyed by what it represents rather than by its rendered content,
 * so a row or a warning whose count changes in place is not read as a new line replacing the old
 */
interface SummaryListItem {
  key: string
  node: ReactNode
}

const ITEM_TRANSITION = { duration: 0.18, ease: EASE }

/**
 * Renders one row's label, an arrow connecting it to the value, and the value itself, wrapping
 * rather than crowding out the connector when the value runs long
 */
function SummaryRow({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return (
    <div>
      <div className="flex items-center gap-3">
        <span className="shrink-0 text-sm font-medium" style={{ color: 'var(--app-text-muted)' }}>
          {label}
        </span>
        <span aria-hidden className="flex flex-1 min-w-6 items-center">
          <span className="w-full" style={{ borderTop: '1px dashed var(--app-border)' }} />
          <ArrowRight size={12} className="shrink-0" style={{ color: 'var(--app-text-muted)' }} />
        </span>
        <span className="min-w-0 text-right text-sm font-semibold" style={{ color: 'var(--app-text)' }}>
          {value}
        </span>
      </div>
      {detail && (
        <p className="text-sm" style={{ color: 'var(--app-text-muted)' }}>
          {detail}
        </p>
      )}
    </div>
  )
}

/**
 * Renders what a bulk edit would do to the selected transactions: a row per detail it sends, a note
 * for anything it passes over, and a warning for anything the server would refuse
 *
 * The box eases between its own measured heights as a row appears, settles or leaves, rather than
 * jumping in one frame, and the content-sized panel around it follows along. The panel itself is
 * never animated, since the drop-downs inside it track their trigger while it is open and a moving
 * panel would carry them out of place. Rows are keyed by their label and notes and warnings by
 * their kind, so a count changing in place rewrites a line's text without replaying its entrance.
 * Warnings sit under a rule below the rows and notes, since they are what holds Apply disabled
 * rather than a description of what the edit does
 */
export default function BulkEditSummary({ summary }: BulkEditSummaryProps) {
  const { rows, notes, warnings } = summary
  const isEmpty = rows.length === 0 && warnings.length === 0

  const contentRef = useRef<HTMLDivElement>(null)
  // Null until the first measurement lands, which is what lets the box render unconstrained at
  // mount. That first measurement then reports the same height the unconstrained box already has,
  // so easing to it moves nothing, and only a later measurement, taken after a row changes the
  // content, actually has a different height to ease towards
  const [measuredHeight, setMeasuredHeight] = useState<number | null>(null)
  const [isEasingHeight, setIsEasingHeight] = useState(false)

  useLayoutEffect(() => {
    const node = contentRef.current
    if (!node) return undefined

    const observer = new ResizeObserver(() => setMeasuredHeight(node.offsetHeight))
    observer.observe(node)
    return () => observer.disconnect()
  }, [])

  const items: SummaryListItem[] = isEmpty
    ? [{
        key: 'empty',
        node: (
          <p className="text-sm" style={{ color: 'var(--app-text-muted)' }}>
            Nothing changes yet. Set a detail above.
          </p>
        ),
      }]
    : [
        ...rows.map((row) => ({
          key: row.label,
          node: <SummaryRow label={row.label} value={row.value} detail={row.detail} />,
        })),

        // Reaching this branch already means a row or a warning is standing, which is the same
        // gate a note needs, so nothing further conditions it here
        ...notes.map((note) => ({
          key: note.key,
          node: (
            <div className="flex items-start gap-1.5 text-sm" style={{ color: 'var(--app-text-muted)' }}>
              <Info size={15} strokeWidth={2.5} className="mt-0.5 shrink-0" aria-hidden />
              <span>{note.text}</span>
            </div>
          ),
        })),

        // Only the first warning carries the rule that sets the group apart from the rows and
        // notes above it, since later ones sit directly under the one before
        ...warnings.map((warning, index) => ({
          key: warning.key,
          node: (
            <div
              className="flex items-start gap-1.5 text-sm"
              style={{
                color: 'var(--app-warning-text)',
                ...(index === 0 ? { borderTop: '1px solid var(--app-border)', paddingTop: '0.75rem' } : {}),
              }}
            >
              <TriangleAlert size={15} strokeWidth={2.5} className="mt-0.5 shrink-0" aria-hidden />
              <span>{warning.text}</span>
            </div>
          ),
        })),
      ]

  return (
    <motion.div
      animate={{ height: measuredHeight ?? 'auto' }}
      transition={ITEM_TRANSITION}
      style={{ overflow: isEasingHeight ? 'hidden' : 'visible' }}
      onAnimationStart={() => setIsEasingHeight(true)}
      onAnimationComplete={() => setIsEasingHeight(false)}
    >
      <div ref={contentRef} className="relative flex flex-col gap-3">
        <AnimatePresence initial={false} mode="popLayout">
          {items.map((item) => (
            <motion.div
              key={item.key}
              layout
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={ITEM_TRANSITION}
            >
              {item.node}
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </motion.div>
  )
}
