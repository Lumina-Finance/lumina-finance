import { Fragment, type RefObject, type UIEvent } from 'react'
import { DropdownBadge } from './Badge'
import type { DropdownOption, DropdownOptionGroup } from './types'

interface DropdownOptionListProps {
  effectiveHighlightedIndex: number
  groupedOptions: DropdownOptionGroup[] | null
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
 * Renders one option row with the shared selected and highlighted states used by grouped and flat menus
 */
function DropdownOptionRow({
  flatIndex,
  highlighted,
  option,
  selected,
  onHighlight,
  onSelect,
}: DropdownOptionRowProps) {
  return (
    <li
      role="option"
      aria-selected={selected}
      data-option-index={flatIndex}
      className="flex cursor-pointer items-center gap-2 px-4 py-2 text-sm transition-colors duration-100"
      style={{
        background: highlighted ? 'var(--app-accent-soft)' : 'transparent',
        color: selected ? 'var(--app-accent)' : 'var(--app-text)',
      }}
      onMouseEnter={() => onHighlight(flatIndex)}
      onMouseDown={(event) => event.preventDefault()}
      onClick={() => onSelect(option.value)}
    >
      {option.icon && (
        <span className="shrink-0 text-base leading-none" aria-hidden>
          {option.icon}
        </span>
      )}
      <span className="min-w-0 truncate">{option.label}</span>
      {option.badge && <DropdownBadge label={option.badge} />}
    </li>
  )
}

/**
 * Renders dropdown options, grouped headers, empty text, and loading status inside the scrollable listbox
 */
export function DropdownOptionList({
  effectiveHighlightedIndex,
  groupedOptions,
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
      role="listbox"
      className="overflow-auto"
      style={{ maxHeight: listMaxHeight }}
      onScroll={onScroll}
    >
      {options.length === 0 && !showLoading ? (
        <li className="px-4 py-2 text-sm" style={{ color: 'var(--app-text-subtle)' }}>
          No results
        </li>
      ) : groupedOptions ? (
        groupedOptions.map((group, groupIndex) => (
          <Fragment key={`${group.label}-${groupIndex}`}>
            <li
              role="presentation"
              className="sticky top-0 z-10 px-4 py-1.5 text-xs font-semibold uppercase tracking-wide"
              style={{
                color: 'var(--app-text-subtle)',
                background: 'var(--app-input-bg)',
                borderBottom: '1px solid var(--app-border)',
              }}
            >
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
      {showLoading && (
        <li className="px-4 py-2 text-sm" style={{ color: 'var(--app-text-subtle)' }}>
          {loadingText}
        </li>
      )}
    </ul>
  )
}
