import { AnimatePresence, motion } from 'motion/react'

interface TransactionModalSubmitErrorProps {
  error: string
}

/**
 * Renders the animated form-level submit error message
 */
export default function TransactionModalSubmitError({ error }: TransactionModalSubmitErrorProps) {
  return (
    <AnimatePresence>
      {error && (
        <motion.p
          className="text-sm font-medium"
          style={{ color: 'var(--app-negative)' }}
          initial={{ opacity: 0, y: -4 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -4 }}
          transition={{ duration: 0.15 }}
        >
          {error}
        </motion.p>
      )}
    </AnimatePresence>
  )
}
