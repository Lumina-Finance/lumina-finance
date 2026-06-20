import { Check, Search } from 'lucide-react'
import { useInfiniteMerchants } from '@/api/merchants'
import { useInfiniteTags } from '@/api/tags'
import { joinClassNames } from '@/utils/classNames'
import { useDebouncedReferenceSearch } from '@/pages/transactions/components/transaction-modal/hooks/useDebouncedReferenceSearch'

const REFERENCE_SEARCH_DEBOUNCE_MS = 250
const REFERENCE_PAGE_SIZE = 20

type ReferenceFacetProps = {
  kind: 'merchants' | 'tags'
  selectedValues: string[]
  // Labels for already-selected ids so a chosen item stays readable even when the search hides it
  selectedLabels: Record<string, string>
  searchPlaceholder: string
  // Mobile full screen lets the result list grow to fill the panel instead of the capped height
  fillHeight: boolean
  onToggle: (value: string, label: string) => void
}

/**
 * Renders a server-searched multi-select for merchants or tags, since those lists are paginated and
 * too large to load and filter on the client
 */
export function ReferenceFacet({ kind, selectedValues, selectedLabels, searchPlaceholder, fillHeight, onToggle }: ReferenceFacetProps) {
  const { search, activeSearchText, setSearch } = useDebouncedReferenceSearch(REFERENCE_SEARCH_DEBOUNCE_MS)

  // Both hooks are called to satisfy the rules of hooks, but only the active kind fetches
  const merchantQuery = useInfiniteMerchants({ q: activeSearchText || undefined }, REFERENCE_PAGE_SIZE, kind === 'merchants')
  const tagQuery = useInfiniteTags({ q: activeSearchText || undefined }, REFERENCE_PAGE_SIZE, kind === 'tags')
  const query = kind === 'merchants' ? merchantQuery : tagQuery

  const results = (query.data?.pages.flat() ?? []).map((item) => ({ value: item.id, label: item.name }))

  // Pin the selected items the current search does not return so they stay visible and deselectable
  const resultIds = new Set(results.map((option) => option.value))
  const pinnedSelected = selectedValues
    .filter((value) => !resultIds.has(value))
    .map((value) => ({ value, label: selectedLabels[value] ?? value }))
  const options = [...pinnedSelected, ...results]

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
        {query.isPending ? (
          <li className="px-2 py-2 text-xs" style={{ color: 'var(--app-text-subtle)' }}>
            Loading…
          </li>
        ) : options.length === 0 ? (
          <li className="px-2 py-2 text-xs" style={{ color: 'var(--app-text-subtle)' }}>
            No matches
          </li>
        ) : (
          options.map((option) => {
            const selected = selectedValues.includes(option.value)
            return (
              <li key={option.value}>
                <button
                  type="button"
                  role="checkbox"
                  aria-checked={selected}
                  onClick={() => onToggle(option.value, option.label)}
                  className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm transition-colors hover:bg-[var(--app-surface-soft)]"
                  style={{ color: selected ? 'var(--app-accent)' : 'var(--app-text)', fontWeight: selected ? 500 : 400 }}
                >
                  <span className="min-w-0 flex-1 truncate">{option.label}</span>
                  {selected && <Check size={15} aria-hidden className="shrink-0" />}
                </button>
              </li>
            )
          })
        )}
      </ul>

      {query.hasNextPage && (
        <p className="px-0.5 text-xs" style={{ color: 'var(--app-text-subtle)' }}>
          Keep typing to narrow the results
        </p>
      )}
    </div>
  )
}
