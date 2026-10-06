import { useId, useState, type CSSProperties, type ReactNode } from 'react'
import { ChevronDown, type LucideIcon } from 'lucide-react'
import { motion, useReducedMotion } from 'motion/react'
import { AppSlotMachineText } from '@/components/display/SlotMachineText'
import { COLLAPSIBLE_SECTION_EASE, COLLAPSIBLE_SECTION_TRANSITION_SECONDS } from './motion'

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

  // Sizing and placement for the header, so a list with a gutter beside its rows, such as a checkbox
  // rail, can run the header across it the way its row backgrounds run, and can stick it below its bar
  headerStyle?: CSSProperties

  // How wide the slot the icon sits at the start of is, so a list can start the label level with its
  // own text while the icon stays put. The icon's own width when not given
  iconSlotWidth?: string
  children: ReactNode
}

/**
 * Renders how many items a section holds as a pill, for a header summary
 *
 * Its number takes the full text colour in every section, since the header's muted one falls below a
 * readable contrast on the pill's tint in the dark theme. A changed count rolls to its new value, and the
 * pill eases to its new width with it
 */
export function CollapsibleSectionCount({ count }: { count: number }) {
  return (
    <span
      className="rounded-full px-2 py-0.5 text-xs font-semibold"
      style={{ background: 'var(--app-accent-soft)', color: 'var(--app-text)' }}
    >
      <AppSlotMachineText text={String(count)} />
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
  headerStyle,
  iconSlotWidth,
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
      {/* Inside a list that scrolls sideways, the header fits the visible width and stays in view. Each
          part sits on the first line, so a summary that wraps keeps the label and chevron level with its
          first line rather than centred between its lines */}
      <button
        type="button"
        className="sticky left-0 z-10 col-span-full flex w-full max-w-[100cqw] items-start gap-3 py-2 text-left transition-colors hover:text-[var(--app-text)]"
        style={{
          borderTop: '1px solid var(--app-border)',
          color: 'var(--app-text-muted)',
          ...headerStyle,
        }}
        aria-expanded={expanded}
        aria-controls={bodyId}
        onClick={handleToggle}
      >
        <span className="flex h-6 shrink-0 items-center" style={{ width: iconSlotWidth }}>
          <Icon size={16} aria-hidden />
        </span>
        <span className="font-medium leading-6">{label}</span>
        <span className="flex min-h-6 min-w-0 flex-1 items-center gap-3">{summary}</span>
        <span className="flex h-6 shrink-0 items-center">
          <ChevronDown size={16} className={`transition-transform ${expanded ? 'rotate-180' : ''}`} aria-hidden />
        </span>
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
