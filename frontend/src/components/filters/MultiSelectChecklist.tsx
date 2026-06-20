import { useState } from 'react'
import { Check, Search } from 'lucide-react'
import type { OptionItem } from '@/components/filters/OptionList'
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

  const filtered = (() => {
    const query = search.trim().toLowerCase()
    if (!query) return options
    return options.filter((option) => option.label.toLowerCase().includes(query))
  })()

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

      <ul className={fillHeight ? 'min-h-0 flex-1 overflow-auto' : 'max-h-56 overflow-auto'}>
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
              <ul>
                {group.items.map((option) => (
                  <ChecklistRow
                    key={option.value}
                    option={option}
                    selected={selectedValues.includes(option.value)}
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
              onToggle={onToggle}
            />
          ))
        )}
      </ul>
    </div>
  )
}

/**
 * Renders one checklist row, showing the option icon, its label, and a trailing check when selected
 */
function ChecklistRow({
  option,
  selected,
  onToggle,
}: {
  option: OptionItem
  selected: boolean
  onToggle: (value: string) => void
}) {
  return (
    <li>
      <button
        type="button"
        role="checkbox"
        aria-checked={selected}
        onClick={() => onToggle(option.value)}
        className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm transition-colors hover:bg-[var(--app-surface-soft)]"
        style={{ color: selected ? 'var(--app-accent)' : 'var(--app-text)', fontWeight: selected ? 500 : 400 }}
      >
        {option.icon && (
          <span className="shrink-0 text-base leading-none" aria-hidden>
            {option.icon}
          </span>
        )}
        <span className="min-w-0 flex-1 truncate">{option.label}</span>
        {selected && <Check size={15} aria-hidden className="shrink-0" />}
      </button>
    </li>
  )
}
