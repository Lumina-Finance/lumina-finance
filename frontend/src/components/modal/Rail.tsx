import type { LucideIcon } from 'lucide-react'
import type { ModalLevel } from '@/components/modal/Shell'

// Title of a dialog, set in the serif every page and modal title uses
export const MODAL_TITLE_CLASS_NAME = 'font-serif text-3xl font-normal'

// The labelled edge of a modal, per level. From 1050px wide, where a modal stops filling the screen, it runs
// down the left edge, and a stacked panel's is narrower and quieter, so it reads as the smaller thing it is
// over a modal that is already open. Below that it lies across the top as a 32px strip, its icon and label in
// a row and centred in it, so a modal always shows its level as one or the other. The strip takes the colours of
// its desktop rail, with a hairline under the stacked one that sits below the 32px
const RAIL = {
  page: {
    className: 'min-[1050px]:w-16 min-[1050px]:py-6',
    style: { background: 'var(--app-button-primary-bg)', color: 'var(--app-button-primary-text)' },
    iconSize: 20,
    iconClassName: 'min-[1050px]:h-5 min-[1050px]:w-5',
    labelClassName: 'text-xs',
  },
  stacked: {
    className:
      'box-content border-b min-[1050px]:box-border min-[1050px]:w-12 min-[1050px]:border-b-0 min-[1050px]:border-r min-[1050px]:py-5',
    style: { background: 'var(--app-surface-soft)', borderColor: 'var(--app-border)', color: 'var(--app-accent)' },
    iconSize: 18,
    iconClassName: 'min-[1050px]:h-[18px] min-[1050px]:w-[18px]',
    labelClassName: 'text-[0.6875rem]',
  },
} as const

interface ModalRailProps {
  level: ModalLevel
  Icon: LucideIcon
  label: string
  /** Left padding of the strip, matching the padding the modal's content starts at */
  insetClassName: string
}

/**
 * The icon and label of a modal. Below 1050px wide a strip across its top, from there up a rail down its
 * left edge with the label running upwards. Hidden from screen readers, since the dialog's title already
 * names it
 */
export function ModalRail({ level, Icon, label, insetClassName }: ModalRailProps) {
  const rail = RAIL[level]

  return (
    <div
      className={`app-modal-rail flex h-8 shrink-0 items-center gap-2 pr-4 min-[1050px]:h-auto min-[1050px]:flex-col min-[1050px]:justify-between min-[1050px]:gap-0 min-[1050px]:px-0 ${insetClassName} ${rail.className}`}
      style={rail.style}
      aria-hidden
    >
      <Icon size={rail.iconSize} strokeWidth={2} className={`h-4 w-4 shrink-0 ${rail.iconClassName}`} />
      <span
        className={`${rail.labelClassName} font-semibold uppercase min-[1050px]:rotate-180 min-[1050px]:[writing-mode:vertical-rl]`}
      >
        {label}
      </span>
    </div>
  )
}
