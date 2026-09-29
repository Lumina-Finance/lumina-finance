import { useId, useState, type ReactNode } from 'react'
import { ChevronDown, type LucideIcon } from 'lucide-react'
import { motion, useReducedMotion } from 'motion/react'

const COLLAPSIBLE_SECTION_EASE = [0.25, 0.1, 0.25, 1] as const
const COLLAPSIBLE_SECTION_TRANSITION_SECONDS = 0.24

type CollapsibleSectionProps = {
  icon: LucideIcon
  label: string

  // Shown after the label in the header, such as how many items the section holds
  summary?: ReactNode
  expanded: boolean
  onToggle: () => void

  // Runs once the body has finished opening, which is the first moment the page height reflects it
  onExpandComplete?: () => void

  // Opens at once and animates only the close, for an owner that scrolls the opened body into view
  // and would otherwise wait for the height to settle first
  opensInstantly?: boolean

  // Placement for the section and its body, so a list laid out on a CSS grid can keep the body's rows
  // on its own column tracks
  className?: string
  bodyClassName?: string
  children: ReactNode
}

/**
 * Renders how many items a section holds as a pill, for a header summary
 */
export function CollapsibleSectionCount({ count }: { count: number }) {
  return (
    <span
      className="rounded-full px-2 py-0.5 text-xs font-semibold"
      style={{ background: 'var(--app-accent-soft)' }}
    >
      {count}
    </span>
  )
}

/**
 * Renders a header button that opens and closes the content below it, animating the content's height
 *
 * The owner holds whether it is open, since some owners change what else is on screen with it. The
 * content mounts on opening and stays mounted until its closing animation finishes. It is clipped only
 * while its height animates, so sticky headings and overflowing tooltips inside it behave normally at rest
 */
export function CollapsibleSection({
  icon: Icon,
  label,
  summary,
  expanded,
  onToggle,
  onExpandComplete,
  opensInstantly = false,
  className,
  bodyClassName = '',
  children,
}: CollapsibleSectionProps) {
  const bodyId = useId()
  const prefersReducedMotion = useReducedMotion()
  const [bodyMounted, setBodyMounted] = useState(expanded)
  const [isAnimating, setIsAnimating] = useState(false)

  function handleToggle() {
    if (!expanded) setBodyMounted(true)
    onToggle()
  }

  function handleAnimationComplete() {
    setIsAnimating(false)
    if (expanded) {
      onExpandComplete?.()
      return
    }

    setBodyMounted(false)
  }

  return (
    <div className={className}>
      <button
        type="button"
        className="col-span-full flex w-full items-center gap-3 py-2 text-left transition-colors hover:text-[var(--app-text)]"
        style={{
          borderTop: '1px solid var(--app-border)',
          color: 'var(--app-text-muted)',
        }}
        aria-expanded={expanded}
        aria-controls={bodyId}
        onClick={handleToggle}
      >
        <Icon size={16} aria-hidden />
        <span className="font-medium">{label}</span>
        <span className="flex min-w-0 flex-1 items-center gap-3">{summary}</span>
        <ChevronDown
          size={16}
          className={`shrink-0 transition-transform ${expanded ? 'rotate-180' : ''}`}
          aria-hidden
        />
      </button>

      <motion.div
        id={bodyId}
        className={bodyClassName}
        initial={false}
        animate={{ height: expanded ? 'auto' : 0, opacity: expanded ? 1 : 0 }}
        transition={{
          duration: prefersReducedMotion || (opensInstantly && expanded) ? 0 : COLLAPSIBLE_SECTION_TRANSITION_SECONDS,
          ease: COLLAPSIBLE_SECTION_EASE,
        }}
        style={{ overflow: isAnimating || !expanded ? 'hidden' : 'visible' }}
        aria-hidden={!expanded}
        inert={!expanded}
        onAnimationStart={() => setIsAnimating(true)}
        onAnimationComplete={handleAnimationComplete}
      >
        {bodyMounted && children}
      </motion.div>
    </div>
  )
}
