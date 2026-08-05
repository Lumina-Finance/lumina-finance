import type { KeyboardEvent, RefObject } from 'react'
import { motion, useReducedMotion } from 'motion/react'
import { ChevronDown } from 'lucide-react'
import { joinClassNames } from '@/utils/classNames'
import { DropdownBadge, DropdownCount } from './Badge'
import { DROPDOWN_INSTANT_TRANSITION, DROPDOWN_SPRING } from './motion'
import type { DropdownOption, DropdownSize } from './types'

interface DropdownHeadProps {
  disabled: boolean
  emptySelectionIsBlank: boolean
  headRef: RefObject<HTMLButtonElement | null>
  id?: string

  /** Id of the element naming this control, for a field whose label sits above it */
  labelledBy?: string

  /** Id of the open list, so assistive software can follow the head to the options it controls */
  listId?: string

  open: boolean
  placeholder: string
  selected: DropdownOption | undefined
  size: DropdownSize
  onClick: () => void
  onKeyDown: (event: KeyboardEvent<HTMLButtonElement>) => void
}

const SIZE_CLASS: Record<DropdownSize, string> = {
  compact: 'app-dropdown-head-compact',
  field: 'app-dropdown-head-field',
}

/**
 * Renders the head of the drop-down, which shows the current value and opens the list
 *
 * It sits inside the box rather than being the box, so the border, background and corner belong to
 * the box and grow with it while this stays the same height throughout.
 */
export function DropdownHead({
  disabled,
  emptySelectionIsBlank,
  headRef,
  id,
  labelledBy,
  listId,
  open,
  placeholder,
  selected,
  size,
  onClick,
  onKeyDown,
}: DropdownHeadProps) {
  const shouldReduceMotion = useReducedMotion()
  const hasVisibleSelection = Boolean(selected && !emptySelectionIsBlank)

  return (
    <button
      ref={headRef}
      id={id}
      type="button"
      role="combobox"
      aria-expanded={open}
      aria-haspopup="listbox"
      aria-controls={open ? listId : undefined}
      aria-labelledby={labelledBy}
      disabled={disabled}
      className={joinClassNames('app-dropdown-head', SIZE_CLASS[size])}
      onClick={onClick}
      onKeyDown={onKeyDown}
    >
      <span
        className="flex min-w-0 flex-1 items-center gap-2"
        style={{ color: hasVisibleSelection ? 'var(--app-text)' : 'var(--app-text-subtle)' }}
      >
        {selected?.icon && !emptySelectionIsBlank && (
          <span className="flex shrink-0 items-center text-base leading-none" aria-hidden>
            {selected.icon}
          </span>
        )}
        <span className="min-w-0 truncate">
          {emptySelectionIsBlank ? '' : selected?.label ?? placeholder}
        </span>
        {hasVisibleSelection && selected?.badge && <DropdownBadge label={selected.badge} />}
        {hasVisibleSelection && selected?.count !== undefined && <DropdownCount count={selected.count} />}
      </span>
      <motion.span
        className="app-dropdown-chevron"
        style={{ display: 'inline-flex' }}
        animate={{ rotate: open ? 180 : 0 }}
        transition={shouldReduceMotion ? DROPDOWN_INSTANT_TRANSITION : DROPDOWN_SPRING}
      >
        <ChevronDown size={16} aria-hidden />
      </motion.span>
    </button>
  )
}
