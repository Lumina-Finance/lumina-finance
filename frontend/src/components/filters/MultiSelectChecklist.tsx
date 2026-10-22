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
  'app-focus-inset focus-visible:bg-transparent! w-full rounded-lg px-2 py-1.5 text-left text-sm hover:bg-[var(--app-accent-soft)]'

// Every row of a list with details shares these tracks, so each column starts at the same place in
// every row: logo, label, type, institution and check from the compact type breakpoint up, and logo,
// stacked text and check below it
const DETAILS_ROW_CLASS_NAME =
  'grid grid-cols-[1.25rem_minmax(0,1fr)_1rem] items-center gap-x-2 min-[750px]:grid-cols-[1.25rem_minmax(0,1fr)_6.5rem_10rem_1rem]'

/**
 * Renders one checklist row, showing the option icon, its label, and a trailing check when selected,
 * with the option's type and institution in their own columns when the list has details
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

  return (
    <li>
      <button
        type="button"
        role="checkbox"
        aria-checked={selected}
        onClick={() => onToggle(option.value)}
        className={joinClassNames(ROW_CLASS_NAME, hasDetails ? DETAILS_ROW_CLASS_NAME : 'flex items-center gap-2')}
        style={getFilterOptionStyle(selected)}
      >
        {option.imageUrl ? (
          <img
            src={option.imageUrl}
            alt=""
            aria-hidden
            loading="lazy"
            className={joinClassNames(
              'h-5 w-5 shrink-0 rounded-md object-contain',
              hasDetails && 'col-start-1 row-span-2 row-start-1 min-[750px]:row-span-1',
            )}
          />
        ) : hasDetails ? (
          <span
            className="col-start-1 row-span-2 row-start-1 flex h-5 w-5 items-center justify-center rounded-md text-xs font-semibold min-[750px]:row-span-1"
            style={{ background: 'var(--app-accent-soft)', border: '1px solid var(--app-border)', color: 'var(--app-accent)' }}
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
        <span className={joinClassNames('min-w-0 truncate', hasDetails ? 'col-start-2 row-start-1' : 'flex-1')}>
          {option.label}
        </span>
        {hasDetails && details && (
          // The wrapper is the second line of the stacked layout and drops out of the grid from the
          // compact type breakpoint, where its two texts become the type and institution columns
          <span
            className="col-start-2 row-start-2 min-w-0 truncate text-xs min-[750px]:contents"
            style={{ color: selected ? undefined : 'var(--app-text-muted)' }}
          >
            <span className="min-[750px]:col-start-3 min-[750px]:row-start-1 min-[750px]:block min-[750px]:truncate min-[750px]:text-sm">
              {details.type}
            </span>
            {details.institution && (
              <>
                <span className="min-[750px]:hidden"> · </span>
                <span className="min-[750px]:col-start-4 min-[750px]:row-start-1 min-[750px]:block min-[750px]:truncate min-[750px]:text-sm">
                  {details.institution}
                </span>
              </>
            )}
          </span>
        )}
        {selected && (
          <Check
            size={15}
            aria-hidden
            className={joinClassNames(
              'shrink-0',
              hasDetails && 'col-start-3 row-span-2 row-start-1 min-[750px]:col-start-5 min-[750px]:row-span-1',
            )}
          />
        )}
      </button>
    </li>
  )
}
