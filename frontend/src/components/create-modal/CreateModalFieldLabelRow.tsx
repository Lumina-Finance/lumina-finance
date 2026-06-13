import type { ReactNode } from 'react'
import { AnimatePresence, motion } from 'motion/react'

interface CreateModalFieldLabelRowProps {
  accessory?: ReactNode
  error?: string
  htmlFor?: string
  label: ReactNode
}

/**
 * Displays a create-modal field label with an optional accessory and animated validation message
 */
export default function CreateModalFieldLabelRow({
  accessory,
  error,
  htmlFor,
  label,
}: CreateModalFieldLabelRowProps) {
  return (
    <div className="mb-1.5 flex items-start justify-between gap-3">
      <div className="flex min-w-0 items-center gap-1.5">
        <label htmlFor={htmlFor} className="app-label block shrink-0 text-[0.9375rem] leading-5">
          {label}
        </label>
        {accessory}
      </div>
      <AnimatePresence initial={false}>
        {error && (
          <motion.p
            key={error}
            className="text-right text-xs font-medium leading-5"
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
