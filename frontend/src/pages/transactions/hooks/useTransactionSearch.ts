import { useEffect, useState } from 'react'

/**
 * Keeps transaction search input responsive while debouncing the API-bound query text
 */
export function useTransactionSearch() {
  const [search, setSearch] = useState('')
  const [activeSearch, setActiveSearch] = useState('')

  // Debounce the API-bound query while keeping the input controlled instantly
  useEffect(() => {
    const timer = setTimeout(() => setActiveSearch(search), 1000)
    return () => clearTimeout(timer)
  }, [search])

  return {
    search,
    setSearch,
    activeSearch,
    submitSearch: () => setActiveSearch(search),
  }
}
