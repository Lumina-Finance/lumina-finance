import { useMemo, useRef, useState, useEffect } from 'react'
import { Search } from 'lucide-react'

export interface OptionItem {
  value: string
  label: string
  group?: string
  icon?: string | null
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
      <div className="px-2 pb-1 pt-2">
        <div className="app-input grid grid-cols-[theme(spacing.9)_minmax(0,1fr)] items-center overflow-hidden px-0 py-0">
          <span className="pointer-events-none flex h-10 w-9 items-center justify-center">
            <Search
              size={14}
              style={{ color: 'var(--app-text-subtle)' }}
              aria-hidden
            />
          </span>
          <input
            ref={inputRef}
            type="text"
            className="h-10 min-w-0 bg-transparent pr-3 text-[0.8125rem] leading-10 outline-none"
            style={{ fontSize: '0.8125rem' }}
            placeholder={searchPlaceholder}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>

      <ul className="max-h-64 overflow-auto pb-1">
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
        className="flex w-full items-center gap-2 px-4 py-1.5 text-left text-sm transition-colors duration-100 hover:bg-[var(--app-surface-soft)]"
        style={{
          color: selected ? 'var(--app-accent)' : 'var(--app-text)',
          fontWeight: selected ? 500 : 400,
        }}
      >
        {option.icon && (
          <span className="shrink-0 text-base leading-none" aria-hidden>
            {option.icon}
          </span>
        )}
        <span className="min-w-0 flex-1 truncate">{option.label}</span>
      </button>
    </li>
  )
}
