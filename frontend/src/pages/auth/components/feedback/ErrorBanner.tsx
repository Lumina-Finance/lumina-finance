import { useEffect, useRef, type ReactNode } from 'react'
import { AlertCircle } from 'lucide-react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'

/**
 * Renders auth errors inside an unpadded collapse wrapper so exit reaches zero height. The
 * message is an alert, and the banner scrolls into view once it has grown and when a new message
 * replaces the old one, since the page can be scrolled to the button that was pressed
 */
export function AuthErrorBanner({ error }: { error: ReactNode }) {
  const bannerRef = useRef<HTMLDivElement>(null)
  const previousError = useRef<ReactNode>(null)
  const reduceMotion = useReducedMotion()

  const behavior = reduceMotion ? 'auto' : 'smooth'

  // Only text can be compared, since other content is rebuilt on every render
  useEffect(() => {
    const replaced = typeof error === 'string' && typeof previousError.current === 'string' && error !== previousError.current
    previousError.current = error
    if (replaced) bannerRef.current?.scrollIntoView({ block: 'nearest', behavior })
  }, [error, behavior])

  return (
    <AnimatePresence>
      {error && (
        <motion.div
          key="error-banner"
          ref={bannerRef}
          className="overflow-hidden"
          initial={{ opacity: 0, height: 0, marginTop: 0 }}
          animate={{ opacity: 1, height: 'auto', marginTop: 20 }}
          exit={{ opacity: 0, height: 0, marginTop: 0 }}
          transition={{ duration: 0.2 }}
          onAnimationComplete={(definition) => {
            // The exit finishing reports a height of 0, which has nothing to show
            if (!Array.isArray(definition) && typeof definition === 'object' && definition.height === 'auto') {
              bannerRef.current?.scrollIntoView({ block: 'nearest', behavior })
            }
          }}
        >
          <div
            role="alert"
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
