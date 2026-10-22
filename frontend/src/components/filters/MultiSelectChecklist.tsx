import { useState } from 'react'
import { Check, Search } from 'lucide-react'
import { filterChecklistOptions } from '@/components/filters/filterChecklistOptions'
import type { OptionItem } from '@/components/filters/OptionList'
import { getFilterOptionListClass, getFilterOptionStyle } from '@/components/filters/optionAppearance'
import { joinClassNames } from '@/utils/classNames'

type MultiSelectChecklistProps = {
  options: OptionItem[]
  selectedValues: string[]
  searchPlaceholder: string
  fillHeight: boolean
  onToggle: (value: string) => void
}

/**
 * Renders a searchable multi-select list, grouping adjacent options under sticky headers and
 * marking the selected rows with a check, mirroring the single-select filter list conventions
 */
export function MultiSelectChecklist({ options, selectedValues, searchPlaceholder, fillHeight, onToggle }: MultiSelectChecklistProps) {
  const [search, setSearch] = useState('')

  const filtered = filterChecklistOptions(options, search)
  const hasDetails = options.some((option) => option.details)

  // Group adjacent items by their group label so each section gets one header, falling back to a
  // flat list when no option carries a group
  const grouped = (() => {
    if (!filtered.some((option) => option.group)) return null
    const groups: { label: string; items: OptionItem[] }[] = []
    let current: string | undefined
    for (const option of filtered) {
      if (option.group !== current || groups.length === 0) {
        current = option.group
        groups.push({ label: option.group ?? '', items: [] })
      }
      groups[groups.length - 1].items.push(option)
    }
    return groups
  })()

  return (
    <div className={joinClassNames('flex flex-col gap-1', fillHeight && 'min-h-0 flex-1')}>
      <div className="app-input grid grid-cols-[2.25rem_minmax(0,1fr)] items-center overflow-hidden px-0 py-0">
        <span className="pointer-events-none flex h-9 w-9 items-center justify-center">
          <Search size={14} style={{ color: 'var(--app-text-subtle)' }} aria-hidden />
        </span>
        <input
          type="text"
          className="h-9 min-w-0 bg-transparent pr-3 text-[0.8125rem] outline-none"
          placeholder={searchPlaceholder}
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
      </div>

      <ul className={getFilterOptionListClass(fillHeight)}>
        {filtered.length === 0 ? (
          <li className="px-2 py-2 text-xs" style={{ color: 'var(--app-text-subtle)' }}>
            No matches
          </li>
        ) : grouped ? (
          grouped.map((group) => (
            <li key={group.label}>
              <div
                className="sticky top-0 z-10 px-2 py-1 text-[0.625rem] font-semibold uppercase tracking-wide"
                style={{ color: 'var(--app-text-subtle)', background: 'var(--app-input-bg)' }}
              >
                {group.label}
              </div>
              <ul className="space-y-1">
                {group.items.map((option) => (
                  <ChecklistRow
                    key={option.value}
                    option={option}
                    selected={selectedValues.includes(option.value)}
                    hasDetails={hasDetails}
                    onToggle={onToggle}
                  />
                ))}
              </ul>
            </li>
          ))
        ) : (
          filtered.map((option) => (
            <ChecklistRow
              key={option.value}
              option={option}
              selected={selectedValues.includes(option.value)}
              hasDetails={hasDetails}
              onToggle={onToggle}
            />
          ))
        )}
      </ul>
    </div>
  )
}

const ROW_CLASS_NAME =
  'app-focus-inset focus-visible:bg-transparent! w-full items-center rounded-lg px-2 py-1.5 text-left text-sm hover:bg-[var(--app-accent-soft)]'

// A row with details is a grid, since a flex row would size itself to the full width of its text and
// push the dialog wider than its panel, where a grid track that may shrink to nothing lets the text cut off
const DETAILS_ROW_CLASS_NAME = 'grid grid-cols-[2.25rem_minmax(0,1fr)_1rem] gap-x-2'

// The logo of a row with details is as tall as the two lines beside it, a 1.25rem label line and a 1rem
// type line, and stays square
const LOGO_CLASS_NAME = 'h-5 w-5 rounded-md'
const DETAILS_LOGO_CLASS_NAME = 'h-9 w-9 rounded-lg'

/**
 * Renders one checklist row, showing the option icon, its label, and a trailing check when selected,
 * with the option's type and institution under the label when the list has details
 */
function ChecklistRow({
  option,
  selected,
  hasDetails,
  onToggle,
}: {
  option: OptionItem
  selected: boolean
  hasDetails: boolean
  onToggle: (value: string) => void
}) {
  const { details } = option
  const rowStyle = getFilterOptionStyle(selected, hasDetails)
  const logoClassName = hasDetails ? DETAILS_LOGO_CLASS_NAME : LOGO_CLASS_NAME

  return (
    <li>
      <button
        type="button"
        role="checkbox"
        aria-checked={selected}
        onClick={() => onToggle(option.value)}
        className={joinClassNames(ROW_CLASS_NAME, hasDetails ? DETAILS_ROW_CLASS_NAME : 'flex gap-2')}
        // A list with details sits straight on its dialog's page colour, where the selected tint needs the darker text
        style={rowStyle}
      >
        {option.imageUrl ? (
          <img
            src={option.imageUrl}
            alt=""
            aria-hidden
            loading="lazy"
            className={joinClassNames('shrink-0 object-contain', logoClassName)}
          />
        ) : hasDetails ? (
          <span
            className={joinClassNames('flex shrink-0 items-center justify-center text-sm font-semibold', logoClassName)}
            style={{ background: 'var(--app-accent-soft)', border: '1px solid var(--app-border)', color: 'var(--app-accent-on-page-tint)' }}
            aria-hidden
          >
            $
          </span>
        ) : (
          option.icon && (
            <span className="shrink-0 text-base leading-none" aria-hidden>
              {option.icon}
            </span>
          )
        )}
        {details ? (
          <span className="min-w-0 flex-1">
            <span className="block truncate">{option.label}</span>
            {/* Both states name their colour and the line eases between them in step with the row, since a line that
                inherits the row's colour when selected would jump to the row's colour as it was before easing from it */}
            <span
              className="block truncate text-xs transition-colors duration-150"
              style={{ color: selected ? rowStyle.color : 'var(--app-text-muted)' }}
            >
              {details.institution ? `${details.type} · ${details.institution}` : details.type}
            </span>
          </span>
        ) : (
          <span className="min-w-0 flex-1 truncate">{option.label}</span>
        )}
        {selected && <Check size={15} aria-hidden className="shrink-0" />}
      </button>
    </li>
  )
}
