import { AlertCircle } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'

/**
 * Renders the animated auth error banner for validation and backend failures
 */
export function AuthErrorBanner({ error }: { error: string }) {
  return (
    <AnimatePresence>
      {error && (
        <motion.div
          key="error-banner"
          className="flex items-start gap-3 rounded-xl px-4 py-3"
          style={{
            background: 'var(--app-negative-soft)',
            border: '1px solid var(--app-negative-border)',
          }}
          initial={{ opacity: 0, height: 0, marginTop: 0 }}
          animate={{ opacity: 1, height: 'auto', marginTop: 20 }}
          exit={{ opacity: 0, height: 0, marginTop: 0 }}
          transition={{ duration: 0.2 }}
        >
          <AlertCircle
            size={16}
            className="mt-0.5 shrink-0"
            style={{ color: 'var(--app-negative)' }}
            aria-hidden
          />
          <p className="text-sm" style={{ color: 'var(--app-negative)' }}>
            {error}
          </p>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
