import { motion } from 'motion/react'

interface AnimatedMobileMenuIconProps {
  isOpen: boolean
  shouldReduceMotion: boolean | null
}

/**
 * Renders the animated mobile navigation icon while respecting reduced-motion preferences
 */
export function AnimatedMobileMenuIcon({
  isOpen,
  shouldReduceMotion,
}: AnimatedMobileMenuIconProps) {
  const transition = shouldReduceMotion
    ? { duration: 0 }
    : { duration: 0.24, ease: 'easeOut' as const }

  return (
    <span className="relative block h-5 w-5" aria-hidden>
      <motion.span
        className="absolute left-1/2 top-1/2 h-0.5 w-5 rounded-full"
        style={{ background: 'currentColor', transformOrigin: 'center' }}
        initial={false}
        animate={isOpen ? { x: '-50%', y: '-50%', rotate: 45 } : { x: '-50%', y: '-0.5rem', rotate: 0 }}
        transition={transition}
      />
      <motion.span
        className="absolute left-1/2 top-1/2 h-0.5 w-5 rounded-full"
        style={{ background: 'currentColor', transformOrigin: 'center' }}
        initial={false}
        animate={
          isOpen
            ? { x: '-50%', y: '-50%', opacity: 0, scaleX: 0.35 }
            : { x: '-50%', y: '-50%', opacity: 1, scaleX: 1 }
        }
        transition={transition}
      />
      <motion.span
        className="absolute left-1/2 top-1/2 h-0.5 w-5 rounded-full"
        style={{ background: 'currentColor', transformOrigin: 'center' }}
        initial={false}
        animate={isOpen ? { x: '-50%', y: '-50%', rotate: -45 } : { x: '-50%', y: '0.375rem', rotate: 0 }}
        transition={transition}
      />
    </span>
  )
}

