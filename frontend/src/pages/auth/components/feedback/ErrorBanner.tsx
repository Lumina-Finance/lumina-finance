import type { ReactNode } from 'react'
import { AlertCircle } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'

/**
 * Renders auth errors inside an unpadded collapse wrapper so exit reaches zero height
 */
export function AuthErrorBanner({ error }: { error: ReactNode }) {
  return (
    <AnimatePresence>
      {error && (
        <motion.div
          key="error-banner"
          className="overflow-hidden"
          initial={{ opacity: 0, height: 0, marginTop: 0 }}
          animate={{ opacity: 1, height: 'auto', marginTop: 20 }}
          exit={{ opacity: 0, height: 0, marginTop: 0 }}
          transition={{ duration: 0.2 }}
        >
          <div
            className="flex items-start gap-3 rounded-xl px-4 py-3"
            style={{
              background: 'var(--app-negative-soft)',
              border: '1px solid var(--app-negative-border)',
            }}
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
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
