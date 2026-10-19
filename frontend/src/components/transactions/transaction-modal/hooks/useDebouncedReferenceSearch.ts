import { useEffect, useMemo, useState } from 'react'

interface DebouncedReferenceSearchState {
  search: string
  activeSearch: string
  activeSearchText: string
  setSearch: (value: string) => void
  setActiveSearch: (value: string) => void
  clearSearch: () => void
}

/**
 * Keeps dropdown search text responsive while delaying remote reference lookups until typing settles
 */
export function useDebouncedReferenceSearch(searchDebounceMs: number): DebouncedReferenceSearchState {
  const [search, setSearch] = useState('')
  const [activeSearch, setActiveSearch] = useState('')
  const activeSearchText = useMemo(() => activeSearch.trim(), [activeSearch])

  useEffect(() => {
    const nextSearch = search.trim() ? search : ''
    const timeoutId = window.setTimeout(() => {
      setActiveSearch(nextSearch)
    }, nextSearch ? searchDebounceMs : 0)

    return () => window.clearTimeout(timeoutId)
  }, [search, searchDebounceMs])

  const clearSearch = () => {
    setSearch('')
    setActiveSearch('')
  }

  return {
    search,
    activeSearch,
    activeSearchText,
    setSearch,
    setActiveSearch,
    clearSearch,
  }
}
