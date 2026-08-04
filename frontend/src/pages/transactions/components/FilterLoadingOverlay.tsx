import { motion } from 'motion/react'

// How much of the page colour covers the content while a filter reloads. The overlay does not filter
// its own backdrop: it holds a turning spinner, so the filter ran again for every frame of the load.
// Blurring what it covers is not an option either, because the overlay renders inside that region and
// would blur its own spinner and label, so the cover has to carry the separation on its own
const OVERLAY_OPACITY_PERCENT = 92

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
        background: `color-mix(in srgb, var(--app-bg) ${OVERLAY_OPACITY_PERCENT}%, transparent)`,
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
