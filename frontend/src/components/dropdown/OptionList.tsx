import { Fragment, type RefObject, type UIEvent } from 'react'
import { Check } from 'lucide-react'
import { joinClassNames } from '@/utils/classNames'
import { DropdownBadge, DropdownCount } from './Badge'
import type { DropdownOption, DropdownOptionGroup } from './types'

interface DropdownOptionListProps {
  effectiveHighlightedIndex: number
  groupedOptions: DropdownOptionGroup[] | null
  listId: string
  listMaxHeight: number
  listRef: RefObject<HTMLUListElement | null>
  loadingText: string
  options: DropdownOption[]
  selectedValue: string
  showLoading: boolean
  onHighlight: (index: number) => void
  onScroll: (event: UIEvent<HTMLUListElement>) => void
  onSelect: (value: string) => void
}

interface DropdownOptionRowProps {
  flatIndex: number
  highlighted: boolean
  option: DropdownOption
  selected: boolean
  onHighlight: (index: number) => void
  onSelect: (value: string) => void
}

/**
 * Renders one option row with the shared selected, highlighted and unavailable states used by grouped and flat menus
 */
function DropdownOptionRow({
  flatIndex,
  highlighted,
  option,
  selected,
  onHighlight,
  onSelect,
}: DropdownOptionRowProps) {
  const disabled = Boolean(option.disabled)

  return (
    <li
      role="option"
      aria-selected={selected}
      aria-disabled={disabled || undefined}
      data-option-index={flatIndex}
      className={joinClassNames(
        'app-dropdown-row',
        highlighted && !disabled && 'app-dropdown-row-highlighted',
        selected && 'app-dropdown-row-selected',
        disabled && 'app-dropdown-row-disabled',
      )}
      onMouseEnter={disabled ? undefined : () => onHighlight(flatIndex)}
      onMouseDown={(event) => event.preventDefault()}
      onClick={disabled ? undefined : () => onSelect(option.value)}
    >
      {option.icon && (
        <span className="flex shrink-0 items-center text-base leading-none" aria-hidden>
          {option.icon}
        </span>
      )}
      {/* The label and its description stack, so a badge stays beside the label rather than
          floating against a two-line block */}
      <span className="flex min-w-0 flex-1 flex-col gap-0.5 text-sm">
        <span className="flex min-w-0 items-center gap-2">
          <span className="min-w-0 truncate">{option.label}</span>
          {option.badge && <DropdownBadge label={option.badge} />}
        </span>
        {option.description && (
          <span className="text-xs leading-snug" style={{ color: 'var(--app-text-subtle)' }}>
            {option.description}
          </span>
        )}
      </span>
      {option.count !== undefined && <DropdownCount count={option.count} />}
      {selected && <Check size={16} className="shrink-0" aria-hidden />}
    </li>
  )
}

/**
 * Renders drop-down options, grouped headers, empty text, and loading status inside the scrollable listbox
 */
export function DropdownOptionList({
  effectiveHighlightedIndex,
  groupedOptions,
  listId,
  listMaxHeight,
  listRef,
  loadingText,
  options,
  selectedValue,
  showLoading,
  onHighlight,
  onScroll,
  onSelect,
}: DropdownOptionListProps) {
  return (
    <ul
      ref={listRef}
      id={listId}
      role="listbox"
      className="overflow-auto"
      style={{ maxHeight: listMaxHeight }}
      onScroll={onScroll}
    >
      {options.length === 0 && !showLoading ? (
        <li className="app-dropdown-note">No results</li>
      ) : groupedOptions ? (
        groupedOptions.map((group, groupIndex) => (
          <Fragment key={`${group.label}-${groupIndex}`}>
            <li role="presentation" className="app-dropdown-group">
              {group.label}
            </li>
            {group.items.map(({ option, flatIndex }) => (
              <DropdownOptionRow
                key={option.value}
                flatIndex={flatIndex}
                highlighted={flatIndex === effectiveHighlightedIndex}
                option={option}
                selected={option.value === selectedValue}
                onHighlight={onHighlight}
                onSelect={onSelect}
              />
            ))}
          </Fragment>
        ))
      ) : (
        options.map((option, index) => (
          <DropdownOptionRow
            key={option.value}
            flatIndex={index}
            highlighted={index === effectiveHighlightedIndex}
            option={option}
            selected={option.value === selectedValue}
            onHighlight={onHighlight}
            onSelect={onSelect}
          />
        ))
      )}
      {showLoading && <li className="app-dropdown-note">{loadingText}</li>}
    </ul>
  )
}
