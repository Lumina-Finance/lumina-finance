
import { AnimatePresence, motion } from 'motion/react'
import type { FieldLabelRowProps } from '@/budgets/types'

/**
 * Renders a form label with animated inline validation text
 */
export default function FieldLabelRow({ label, htmlFor, error }: FieldLabelRowProps) {
  return (
    <div className="mb-1.5 flex min-w-0 items-start justify-between gap-3">
      <label htmlFor={htmlFor} className="app-label block min-w-0 text-[0.9375rem] leading-5">
        {label}
      </label>
      <AnimatePresence initial={false}>
        {error && (
          <motion.p
            key={error}
            className="min-w-0 shrink text-right text-xs font-medium leading-5"
            style={{ color: 'var(--app-negative)' }}
            initial={{ opacity: 0, x: 4 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 4 }}
            transition={{ duration: 0.15 }}
          >
            {error}
          </motion.p>
        )}
      </AnimatePresence>
    </div>
  )
}
