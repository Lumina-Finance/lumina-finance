import type { KeyboardEvent, RefObject } from 'react'
import { ChevronDown } from 'lucide-react'
import { joinClassNames } from '@/utils/classNames'
import { DropdownBadge } from './Badge'
import type { DropdownOption, DropdownSize } from './types'

interface DropdownTriggerProps {
  className?: string
  disabled: boolean
  emptySelectionIsBlank: boolean
  hasError: boolean
  id?: string

  /** Id of the element naming this control, for a field whose label sits above it */
  labelledBy?: string

  /** Id of the open list, so assistive software can follow the pill to the options it controls */
  listId?: string

  open: boolean
  placeholder: string
  selected: DropdownOption | undefined
  size: DropdownSize
  triggerRef: RefObject<HTMLButtonElement | null>
  onClick: () => void
  onKeyDown: (event: KeyboardEvent<HTMLButtonElement>) => void
}

const SIZE_CLASS: Record<DropdownSize, string> = {
  compact: 'app-dropdown-pill-compact',
  field: 'app-dropdown-pill-field',
  toolbar: 'app-dropdown-pill-toolbar',
}

/**
 * Renders the pill that opens the drop-down while the parent owns its state and keyboard policy
 */
export function DropdownTrigger({
  className,
  disabled,
  emptySelectionIsBlank,
  hasError,
  id,
  labelledBy,
  listId,
  open,
  placeholder,
  selected,
  size,
  triggerRef,
  onClick,
  onKeyDown,
}: DropdownTriggerProps) {
  const hasVisibleSelection = Boolean(selected && !emptySelectionIsBlank)

  return (
    <button
      ref={triggerRef}
      id={id}
      type="button"
      role="combobox"
      aria-expanded={open}
      aria-haspopup="listbox"
      aria-controls={open ? listId : undefined}
      aria-labelledby={labelledBy}
      disabled={disabled}
      className={joinClassNames(
        'app-dropdown-pill',
        SIZE_CLASS[size],
        // Only the toolbar size takes the blur. A pill in a form or a table row sits against a flat
        // background with nothing behind it to reveal, and those are the places that render many at once
        size === 'toolbar' && 'app-dropdown-pill-glass',
        hasError && 'app-dropdown-pill-error',
        className,
      )}
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
      </span>
      <ChevronDown size={16} className="app-dropdown-chevron" aria-hidden />
    </button>
  )
}
