import type { LucideIcon } from 'lucide-react'
import type { ModalLevel } from '@/components/modal/Shell'

// Title of a dialog, set in the serif every page and modal title uses
export const MODAL_TITLE_CLASS_NAME = 'font-serif text-3xl font-normal'

// The labelled edge of a modal, per level. A stacked panel's is narrower and quieter, so it reads as the
// smaller thing it is over a modal that is already open
const RAIL = {
  page: {
    className: 'hidden w-16 shrink-0 flex-col items-center justify-between py-6 sm:flex',
    style: { background: 'var(--app-button-primary-bg)', color: 'var(--app-button-primary-text)' },
    iconSize: 20,
    labelClassName: 'text-xs',
  },
  stacked: {
    className: 'app-secondary-modal-rail hidden w-12 shrink-0 flex-col items-center justify-between py-5 sm:flex',
    style: {
      background: 'var(--app-surface-soft)',
      borderRight: '1px solid var(--app-border)',
      color: 'var(--app-accent)',
    },
    iconSize: 18,
    labelClassName: 'text-[0.6875rem]',
  },
} as const

interface ModalRailProps {
  level: ModalLevel
  Icon: LucideIcon
  label: string
}

/**
 * The icon and vertical label along the left edge of a modal, shown from the sm width up and hidden from
 * screen readers, since the dialog's title already names it
 */
export function ModalRail({ level, Icon, label }: ModalRailProps) {
  const rail = RAIL[level]

  return (
    <div className={rail.className} style={rail.style} aria-hidden>
      <Icon size={rail.iconSize} strokeWidth={2} />
      <span
        className={`${rail.labelClassName} rotate-180 font-semibold uppercase`}
        style={{ writingMode: 'vertical-rl' }}
      >
        {label}
      </span>
    </div>
  )
}
