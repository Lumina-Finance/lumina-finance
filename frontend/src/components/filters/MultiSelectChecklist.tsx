import { useState } from 'react'
import { Check } from 'lucide-react'
import { filterChecklistOptions } from '@/components/filters/filterChecklistOptions'
import type { OptionItem } from '@/components/filters/OptionList'
import { SearchField } from '@/components/filters/SearchField'
import {
  getFilterOptionGapClass,
  getFilterOptionListClass,
  getFilterOptionStyle,
} from '@/components/filters/optionAppearance'
import { useUsableLogo } from '@/hooks/useUsableLogo'
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
export function MultiSelectChecklist({
  options,
  selectedValues,
  searchPlaceholder,
  fillHeight,
  onToggle,
}: MultiSelectChecklistProps) {
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
      <SearchField value={search} placeholder={searchPlaceholder} onChange={setSearch} />

      <ul className={getFilterOptionListClass(fillHeight, hasDetails, grouped !== null)}>
        {filtered.length === 0 ? (
          <li className="px-2 py-2 text-xs" style={{ color: 'var(--app-text-subtle)' }}>
            No matches
          </li>
        ) : grouped ? (
          grouped.map((group) => (
            <li key={group.label}>
              <div
                className="sticky top-0 z-10 px-2 py-1 text-[0.625rem] font-semibold uppercase tracking-wide"
                // Opaque so rows scrolling under it stay hidden, in the glass panel's own colour where the
                // list sits on one
                style={{
                  color: 'var(--app-text-subtle)',
                  background: 'var(--app-checklist-heading-bg, var(--app-input-bg))',
                }}
              >
                {group.label}
              </div>
              <ul className={getFilterOptionGapClass(hasDetails)}>
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

// A chosen row rests in the soft accent tint, set on the row itself, so the deeper tint it takes under the
// pointer is important to outrank it, along with the text colour that stays readable on it. A row with
// keyboard focus keeps dropping its tint, whether or not the pointer is over it
const ROW_CLASS_NAME =
  'app-focus-inset focus-visible:bg-transparent! w-full items-center rounded-lg px-2 py-1.5 text-left text-sm hover:bg-[var(--app-accent-soft)] aria-checked:not-focus-visible:hover:bg-[var(--app-accent-chosen-hover-fill)]! aria-checked:not-focus-visible:hover:text-[var(--app-accent-on-hover-fill)]!'

// A row with details is a grid, since a flex row would size itself to the full width of its text and
// push the dialog wider than its panel, where a grid track that may shrink to nothing lets the text cut off
const DETAILS_ROW_CLASS_NAME = 'grid grid-cols-[1.6875rem_minmax(0,1fr)_1rem] gap-x-2'

// The logo of a row with details is a square as tall as the text it sits beside as drawn, which runs from
// the top of the label's capitals to the baseline of the type line, 27px in the 14px and 12px text, and
// starts 5px below the top of the row's content since the letters sit low in the line boxes
const LOGO_CLASS_NAME = 'h-5 w-5 rounded-md'
const DETAILS_LOGO_CLASS_NAME = 'mt-1.25 h-6.75 w-6.75 self-start rounded-lg'

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
  const logo = useUsableLogo(option.imageUrl)
  // A list with details sits straight on its dialog's page colour, where the selected tint needs the darker text
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
        style={rowStyle}
      >
        {logo.src ? (
          <img
            src={logo.src}
            alt=""
            aria-hidden
            loading="lazy"
            {...logo.imageProps}
            className={joinClassNames('shrink-0 object-contain', logoClassName)}
          />
        ) : hasDetails || option.imageUrl ? (
          // A row whose logo was dropped keeps its slot, so its label starts where the other rows' labels do
          <span
            className={joinClassNames(
              'flex shrink-0 items-center justify-center font-semibold',
              hasDetails ? 'text-sm' : 'text-xs',
              logoClassName,
            )}
            style={{
              background: 'var(--app-accent-soft)',
              border: '1px solid var(--app-border)',
              color: hasDetails ? 'var(--app-accent-on-page-tint)' : 'var(--app-accent)',
            }}
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
            {/* Only the name takes the selected look, so the line keeps the muted colour and the regular weight */}
            <span className="block truncate text-xs" style={{ color: 'var(--app-text-muted)', fontWeight: 400 }}>
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
