import { motion } from 'motion/react'

/**
 * Renders the blocking loading overlay used while transaction filters refresh data
 */
export default function TransactionFilterLoadingOverlay({
  placement = 'top',
  reducedMotion,
  label = 'Loading transactions',
}: {
  placement?: 'center' | 'top'
  reducedMotion: boolean | null
  label?: string
}) {
  return (
    <motion.div
      className={`absolute inset-0 z-30 flex min-h-64 flex-col items-center gap-4 ${
        placement === 'center' ? 'justify-center' : 'justify-start pt-24'
      }`}
      style={{
        // Solid rather than translucent, so nothing behind shows through and nothing has to be
        // blurred. A backdrop-filter here would be recomputed for every frame the spinner turns
        background: 'var(--app-bg)',
        touchAction: 'none',
      }}
      role="status"
      aria-live="polite"
      initial={reducedMotion ? false : { opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: reducedMotion ? 0 : 0.18 }}
      onWheel={(event) => event.preventDefault()}
      onTouchMove={(event) => event.preventDefault()}
    >
      <div
        className="h-9 w-9 rounded-full border-2 animate-spin motion-reduce:animate-none"
        style={{ borderColor: 'var(--app-border-strong)', borderTopColor: 'var(--app-accent)' }}
        aria-hidden
      />
      <p
        className="text-xs font-medium uppercase tracking-[0.2em]"
        style={{ color: 'var(--app-text-subtle)' }}
      >
        {label}
      </p>
    </motion.div>
  )
}
