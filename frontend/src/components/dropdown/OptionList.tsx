import { Fragment, type MouseEvent, type RefObject, type UIEvent } from 'react'
import { Check, Pencil } from 'lucide-react'
import { joinClassNames } from '@/utils/classNames'
import { DropdownBadge, DropdownCount } from './Badge'
import { canEditDropdownOption } from './options'
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
  editOptionLabel: string | undefined
  onHighlight: (index: number) => void
  onScroll: (event: UIEvent<HTMLUListElement>) => void
  onSelect: (value: string) => void
  onEditOption: ((value: string) => void) | undefined
}

interface DropdownOptionRowProps {
  flatIndex: number
  highlighted: boolean
  option: DropdownOption
  selected: boolean
  editOptionLabel: string | undefined
  onHighlight: (index: number) => void
  onSelect: (value: string) => void
  onEditOption: ((value: string) => void) | undefined
}

const DEFAULT_EDIT_OPTION_LABEL = 'Edit'

/**
 * Renders one option row with the shared selected, highlighted and unavailable states used by grouped and flat menus
 */
function DropdownOptionRow({
  flatIndex,
  highlighted,
  option,
  selected,
  editOptionLabel,
  onHighlight,
  onSelect,
  onEditOption,
}: DropdownOptionRowProps) {
  const disabled = Boolean(option.disabled)
  const editable = canEditDropdownOption(option, Boolean(onEditOption))

  const handleEdit = (event: MouseEvent<HTMLSpanElement>) => {

    // The row itself chooses the option, so the click stops here rather than doing both
    event.stopPropagation()
    onEditOption?.(option.value)
  }

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
          <span className="min-w-0 truncate" title={option.label}>{option.label}</span>
          {option.badge && <DropdownBadge label={option.badge} />}
        </span>
        {option.description && (
          <span className="text-xs leading-snug" style={{ color: 'var(--app-text-subtle)' }}>
            {option.description}
          </span>
        )}
      </span>
      {option.count !== undefined && <DropdownCount count={option.count} />}

      {/* Held in the row rather than mounted on hover, so the label truncates to one width
          instead of shifting as the pointer runs down the list. The stylesheet is what reveals
          it, and what keeps it from taking clicks meant for the row while it is hidden */}
      {editable && (
        <span
          className="app-dropdown-row-edit shrink-0"
          title={editOptionLabel ?? DEFAULT_EDIT_OPTION_LABEL}
          aria-hidden
          onClick={handleEdit}
        >
          <Pencil size={14} />
        </span>
      )}
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
  editOptionLabel,
  onHighlight,
  onScroll,
  onSelect,
  onEditOption,
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
                editOptionLabel={editOptionLabel}
                onHighlight={onHighlight}
                onSelect={onSelect}
                onEditOption={onEditOption}
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
            editOptionLabel={editOptionLabel}
            onHighlight={onHighlight}
            onSelect={onSelect}
            onEditOption={onEditOption}
          />
        ))
      )}
      {showLoading && <li className="app-dropdown-note">{loadingText}</li>}
    </ul>
  )
}
