import { useMemo, useRef, useState, useEffect } from 'react'
import { Search } from 'lucide-react'

export interface OptionItem {
  value: string
  label: string
  group?: string
}

interface Props {
  options: OptionItem[]
  selectedValue?: string
  onSelect: (value: string) => void
  searchPlaceholder?: string
  emptyLabel?: string
}

export default function FilterOptionList({
  options,
  selectedValue,
  onSelect,
  searchPlaceholder = 'Search...',
  emptyLabel = 'No matches',
}: Props) {
  const [search, setSearch] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  // Auto-focus the search field when the popover opens
  useEffect(() => {
    requestAnimationFrame(() => inputRef.current?.focus())
  }, [])

  const filtered = useMemo(() => {
    if (!search) return options
    const q = search.toLowerCase()
    return options.filter((o) => o.label.toLowerCase().includes(q))
  }, [options, search])

  // Group adjacent items by their group label so each section has one sticky header
  const grouped = useMemo(() => {
    if (!filtered.some((o) => o.group)) return null
    const groups: { label: string; items: OptionItem[] }[] = []
    let current: string | undefined
    for (const o of filtered) {
      if (o.group !== current || groups.length === 0) {
        current = o.group
        groups.push({ label: o.group ?? '', items: [] })
      }
      groups[groups.length - 1].items.push(o)
    }
    return groups
  }, [filtered])

  return (
    <div className="flex flex-col">
      <div className="relative px-2 pt-2">
        <Search
          size={14}
          className="absolute left-4 top-1/2 -translate-y-1/2"
          style={{ color: 'var(--app-text-subtle)' }}
          aria-hidden
        />
        <input
          ref={inputRef}
          type="text"
          className="app-input w-full pl-8"
          style={{ fontSize: '0.8125rem' }}
          placeholder={searchPlaceholder}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      <ul className="max-h-64 overflow-auto py-1">
        {filtered.length === 0 ? (
          <li className="px-4 py-2 text-sm" style={{ color: 'var(--app-text-subtle)' }}>
            {emptyLabel}
          </li>
        ) : grouped ? (
          grouped.map((group) => (
            <li key={group.label}>
              <div
                className="sticky top-0 px-4 py-1.5 text-xs font-semibold uppercase tracking-wide z-10"
                style={{
                  color: 'var(--app-text-subtle)',
                  background: 'var(--app-bg)',
                  borderBottom: '1px solid var(--app-border)',
                }}
              >
                {group.label}
              </div>
              <ul>
                {group.items.map((o) => (
                  <Row key={o.value} option={o} selected={o.value === selectedValue} onSelect={onSelect} />
                ))}
              </ul>
            </li>
          ))
        ) : (
          filtered.map((o) => (
            <Row key={o.value} option={o} selected={o.value === selectedValue} onSelect={onSelect} />
          ))
        )}
      </ul>
    </div>
  )
}

function Row({
  option,
  selected,
  onSelect,
}: {
  option: OptionItem
  selected: boolean
  onSelect: (value: string) => void
}) {
  return (
    <li>
      <button
        type="button"
        onClick={() => onSelect(option.value)}
        className="w-full text-left px-4 py-1.5 text-sm transition-colors duration-100 hover:bg-[var(--app-surface-soft)]"
        style={{
          color: selected ? 'var(--app-accent)' : 'var(--app-text)',
          fontWeight: selected ? 500 : 400,
        }}
      >
        {option.label}
      </button>
    </li>
  )
}
