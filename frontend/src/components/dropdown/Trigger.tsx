import type { KeyboardEvent, RefObject } from 'react'
import { motion, useReducedMotion } from 'motion/react'
import { ChevronDown } from 'lucide-react'
import { useDisabledReason } from '@/hooks/useDisabledReason'
import { getDisabledReasonProps } from '@/utils/disabledReasonControl'
import { joinClassNames } from '@/utils/classNames'
import { DropdownBadge, DropdownCount } from './Badge'
import { DROPDOWN_INSTANT_TRANSITION, DROPDOWN_SPRING } from './motion'
import type { DropdownOption, DropdownSize } from './types'

interface DropdownHeadProps {
  disabled: boolean

  /**
   * Why the dropdown is unavailable, shown in a tooltip beside the cursor, on keyboard focus and on a
   * tap. The head then stays focusable and hoverable, marked aria-disabled, and opens nothing
   */
  disabledReason?: string
  hasError: boolean
  emptySelectionIsBlank: boolean
  headRef: RefObject<HTMLButtonElement | null>
  id?: string

  /** Stable identity for an individual control whose visible label changes */
  testId?: string

  /**
   * Id of the visible label this control takes its accessible name from, for a field whose label
   * sits above it
   */
  labelledBy?: string

  /** Id of supporting text that explains an additional keyboard action */
  describedBy?: string

  /** Id of the open list, so assistive software can follow the head to the options it controls */
  listId?: string

  /** A shortcut elsewhere on the page that jumps to this head, written as `aria-keyshortcuts` writes it */
  keyShortcuts?: string

  open: boolean
  placeholder: string
  selected: DropdownOption | undefined
  size: DropdownSize

  /**
   * True once the value is blank and resolves to an option the caller listed, under a dropdown
   * that opted in to drawing that as a placeholder rather than as a real selection
   */
  blankOptionSelected: boolean

  onClick: () => void
  onKeyDown: (event: KeyboardEvent<HTMLButtonElement>) => void
}

const SIZE_CLASS: Record<DropdownSize, string> = {
  compact: 'app-dropdown-head-compact',
  field: 'app-dropdown-head-field',
}

/**
 * Renders the head of the dropdown, which shows the current value and opens the list
 *
 * It sits inside the box rather than being the box, so the border, background and corner belong to
 * the box and grow with it while this stays the same height throughout.
 */
export function DropdownHead({
  disabled,
  disabledReason,
  hasError,
  emptySelectionIsBlank,
  headRef,
  id,
  testId,
  labelledBy,
  describedBy,
  listId,
  keyShortcuts,
  open,
  placeholder,
  selected,
  size,
  blankOptionSelected,
  onClick,
  onKeyDown,
}: DropdownHeadProps) {
  const shouldReduceMotion = useReducedMotion()
  const hasVisibleSelection = Boolean(selected && !emptySelectionIsBlank && !blankOptionSelected)
  const reason = useDisabledReason(disabled ? disabledReason : undefined)
  const reasonProps = getDisabledReasonProps<HTMLButtonElement>(reason, {
    'aria-describedby': describedBy,
    onClick,
    onKeyDown,
  })

  return (
    <>
      <button
        ref={headRef}
        id={id}
        data-testid={testId}
        type="button"
        role="combobox"
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-controls={open ? listId : undefined}
        aria-labelledby={labelledBy}
        aria-keyshortcuts={keyShortcuts}
        aria-invalid={hasError || undefined}
        disabled={disabled && !reason.isUnavailable}
        className={joinClassNames('app-dropdown-head', SIZE_CLASS[size])}
        {...reasonProps}
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
          {/* Only a real choice carries the full text, since a tooltip repeating the placeholder
            says nothing the control is not already showing */}
          <span className="min-w-0 truncate" title={hasVisibleSelection ? selected?.label : undefined}>
            {emptySelectionIsBlank ? '' : (selected?.label ?? placeholder)}
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
      {reason.tooltip}
    </>
  )
}
