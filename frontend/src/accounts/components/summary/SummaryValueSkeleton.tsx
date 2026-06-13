import { motion, useReducedMotion } from 'motion/react'

type SummaryValueSkeletonProps = {
  label: string
  className: string
}

/**
 * Renders a reduced-motion aware placeholder for loading summary values
 */
export function SummaryValueSkeleton({
  label,
  className,
}: SummaryValueSkeletonProps) {
  const shouldReduceMotion = useReducedMotion() ?? false

  return (
    <div
      className={`relative overflow-hidden rounded-md ${className}`}
      role="status"
      aria-label={label}
      style={{
        background: 'var(--app-border)',
      }}
    >
      {!shouldReduceMotion && (
        <motion.span
          className="absolute inset-y-0 left-0 w-2/3"
          aria-hidden
          initial={{ x: '-140%' }}
          animate={{ x: '190%' }}
          transition={{ duration: 1.15, ease: 'easeInOut', repeat: Infinity }}
          style={{
            background:
              'linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.62), transparent)',
          }}
        />
      )}
    </div>
  )
}
