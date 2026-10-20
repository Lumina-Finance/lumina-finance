import { AnimatePresence, motion } from 'motion/react'

interface TransactionModalSubmitErrorProps {
  error: string

  // An optional heading shown above the message, used when one leg of a transfer pair fails
  title?: string
}

/**
 * Renders the animated form-level submit error, with an optional bold heading
 */
export default function TransactionModalSubmitError({ error, title }: TransactionModalSubmitErrorProps) {
  return (
    <AnimatePresence>
      {error && (
        <motion.div
          className="text-sm font-medium"
          style={{ color: 'var(--app-negative)' }}
          initial={{ opacity: 0, y: -4 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -4 }}
          transition={{ duration: 0.15 }}
        >
          {title && <p className="font-semibold">{title}</p>}
          <p>{error}</p>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
