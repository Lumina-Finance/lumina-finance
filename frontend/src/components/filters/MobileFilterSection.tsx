import { useMemo, useState, type KeyboardEvent } from 'react'
import type { OptionItem } from '@/components/FilterOptionList'
import { MobileOptionRow } from '@/components/filters/MobileOptionRow'

type MobileFilterSectionProps = {
  title: string
  options: OptionItem[]
  selectedValue?: string
  selectedLabel: string | null
  searchPlaceholder: string
  allLabel: string
  onSelect: (value: string) => void
  onClear: () => void
  selectFirstSearchResultOnEnter?: boolean
}

/**
 * Renders one searchable filter group inside a mobile filter sheet
 */
export function MobileFilterSection({
  title,
  options,
  selectedValue,
  selectedLabel,
  searchPlaceholder,
  allLabel,
  onSelect,
  onClear,
  selectFirstSearchResultOnEnter = false,
}: MobileFilterSectionProps) {
  const [search, setSearch] = useState('')
  const hasSearch = search.trim().length > 0

  const filteredOptions = useMemo(() => {
    const query = search.trim().toLowerCase()
    if (!query) return options
    return options.filter((option) => option.label.toLowerCase().includes(query))
  }, [options, search])

  const groupedOptions = useMemo(() => {
    if (!filteredOptions.some((option) => option.group)) return null

    const groups: { label: string; items: OptionItem[] }[] = []
    let currentGroup: string | undefined

    for (const option of filteredOptions) {
      if (option.group !== currentGroup || groups.length === 0) {
        currentGroup = option.group
        groups.push({ label: option.group ?? '', items: [] })
      }
      groups[groups.length - 1].items.push(option)
    }

    return groups
  }, [filteredOptions])
  const highlightedValue = selectFirstSearchResultOnEnter && hasSearch ? filteredOptions[0]?.value : undefined

  /**
   * Allows keyboard users to select the first search match without moving focus into the result list
   */
  function handleSearchKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key !== 'Enter' || !highlightedValue) return
    event.preventDefault()
    onSelect(highlightedValue)
  }

  return (
    <section>
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold uppercase tracking-wide" style={{ color: 'var(--app-text-muted)' }}>
            {title}
          </h3>
          {selectedLabel && (
            <p className="mt-0.5 truncate text-sm" style={{ color: 'var(--app-accent)' }}>
              {selectedLabel}
            </p>
          )}
        </div>
        {selectedValue && (
          <button
            type="button"
            className="text-sm font-medium"
            style={{ color: 'var(--app-accent)' }}
            onClick={onClear}
          >
            Clear
          </button>
        )}
      </div>

      <input
        type="text"
        className="app-input mb-2"
        placeholder={searchPlaceholder}
        value={search}
        onChange={(event) => setSearch(event.target.value)}
        onKeyDown={handleSearchKeyDown}
      />

      <div className="max-h-48 overflow-y-auto overscroll-contain rounded-xl border pr-2 [scrollbar-gutter:stable]" style={{ borderColor: 'var(--app-border)' }}>
        <MobileOptionRow label={allLabel} selected={!selectedValue} onClick={onClear} />
        {filteredOptions.length === 0 ? (
          <div className="px-3 py-2 text-sm" style={{ color: 'var(--app-text-subtle)' }}>
            No matches
          </div>
        ) : groupedOptions ? (
          groupedOptions.map((group) => (
            <div key={group.label}>
              {group.label && (
                <div
                  className="sticky top-0 z-10 border-y px-3 py-1.5 text-xs font-semibold uppercase tracking-wide"
                  style={{
                    background: 'var(--app-bg)',
                    borderColor: 'var(--app-border)',
                    color: 'var(--app-text-subtle)',
                  }}
                >
                  {group.label}
                </div>
              )}
              {group.items.map((option) => (
                <MobileOptionRow
                  key={option.value}
                  label={option.label}
                  icon={option.icon}
                  selected={option.value === selectedValue}
                  highlighted={option.value === highlightedValue}
                  onClick={() => onSelect(option.value)}
                />
              ))}
            </div>
          ))
        ) : (
          filteredOptions.map((option) => (
            <MobileOptionRow
              key={option.value}
              label={option.label}
              icon={option.icon}
              selected={option.value === selectedValue}
              highlighted={option.value === highlightedValue}
              onClick={() => onSelect(option.value)}
            />
          ))
        )}
      </div>
    </section>
  )
}
