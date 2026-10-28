import { AnimatePresence, motion } from 'motion/react'

interface CreateModalSectionHeadingRowProps {
  label: string
  error?: string | false | null
  /** Id for the message, so the field it is about can point to it as its description */
  errorId?: string
}

/**
 * The heading of a create-modal section holding one field, with that field's validation message
 * opposite it, so the problem shows where the field is rather than in the footer
 */
export default function CreateModalSectionHeadingRow({ label, error, errorId }: CreateModalSectionHeadingRowProps) {
  return (
    <div className="flex min-h-4 items-start justify-between gap-3">
      <p className="flex h-4 items-center text-base font-bold leading-none" style={{ color: 'var(--app-accent)' }}>{label}</p>
      <AnimatePresence initial={false}>
        {error && (
          <motion.p
            key={error}
            id={errorId}
            role="alert"
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
