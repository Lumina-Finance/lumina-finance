import type { KeyboardEvent, RefObject } from 'react'
import { ChevronDown } from 'lucide-react'
import { DropdownBadge } from './Badge'
import type { DropdownOption } from './types'

interface DropdownTriggerProps {
  className: string
  disabled: boolean
  emptySelectionIsBlank: boolean
  id?: string
  open: boolean
  placeholder: string
  selected: DropdownOption | undefined
  triggerRef: RefObject<HTMLButtonElement | null>
  onClick: () => void
  onKeyDown: (event: KeyboardEvent<HTMLButtonElement>) => void
}

/**
 * Renders the combobox trigger while the parent owns dropdown state and keyboard policy
 */
export function DropdownTrigger({
  className,
  disabled,
  emptySelectionIsBlank,
  id,
  open,
  placeholder,
  selected,
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
      disabled={disabled}
      className={`${className} flex items-center justify-between gap-2 text-left disabled:cursor-not-allowed disabled:opacity-60`}
      onClick={onClick}
      onKeyDown={onKeyDown}
    >
      <span
        className="flex min-w-0 flex-1 items-center gap-2"
        style={{ color: hasVisibleSelection ? 'var(--app-text)' : 'var(--app-text-subtle)' }}
      >
        {selected?.icon && !emptySelectionIsBlank && (
          <span className="shrink-0 text-base leading-none" aria-hidden>
            {selected.icon}
          </span>
        )}
        <span className="min-w-0 truncate">
          {emptySelectionIsBlank ? '' : selected?.label ?? placeholder}
        </span>
        {hasVisibleSelection && selected?.badge && <DropdownBadge label={selected.badge} />}
      </span>
      <ChevronDown
        size={16}
        className="shrink-0 transition-transform duration-200"
        style={{
          color: 'var(--app-text-subtle)',
          transform: open ? 'rotate(180deg)' : 'rotate(0)',
        }}
        aria-hidden
      />
    </button>
  )
}

