import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { fetchMerchantNameMatches, useInfiniteMerchants, type Merchant } from '@/api/merchants'
import { merchantKeys } from '@/api/cache/queryKeys'
import { getMerchantNameKey } from '@/api/shared/merchantNameKey'
import { useAuth } from '@/hooks/useAuth'
import { buildImportMerchantOptions } from '@/pages/imports/utils'

// Merchants one search page holds, matching what the transaction modal's own merchant search uses
const MERCHANT_SEARCH_PAGE_SIZE = 20

/**
 * Loads which of a file's payee values already have a merchant, and drives the search a user runs
 * to point one at a merchant the file never mentions
 *
 * The page asks about the file rather than holding every merchant, since a person can build up
 * thousands of them while the list endpoint answers a page at a time. The search is shared by every
 * row, so a step listing hundreds of values still runs one search query at a time
 *
 * @param importedMerchants - One payee value per merchant the file resolves to
 */
export function useImportMerchantMatches(importedMerchants: string[]) {
  const { accessToken } = useAuth()
  const [merchantSearch, setMerchantSearch] = useState('')

  const {
    data: matches = [],
    isLoading: matchesLoading,
    isError: matchesFailed,
    refetch: refetchMatches,
  } = useQuery({
    queryKey: merchantKeys.nameMatches(importedMerchants),
    queryFn: () => fetchMerchantNameMatches(importedMerchants),
    enabled: Boolean(accessToken) && importedMerchants.length > 0,
  })

  const trimmedSearch = merchantSearch.trim()
  const {
    data: searchPages,
    isFetching: searchFetching,
    hasNextPage: hasMoreSearchResults,
    fetchNextPage: fetchMoreSearchResults,
  } = useInfiniteMerchants(
    { q: trimmedSearch },
    MERCHANT_SEARCH_PAGE_SIZE,
    Boolean(accessToken) && trimmedSearch.length > 0,
  )

  const matchedMerchantByKey = useMemo(
    () => new Map(matches.map((match) => [getMerchantNameKey(match.source), match.merchant])),
    [matches],
  )

  const merchantOptions = useMemo(
    () => {
      const searched: Merchant[] = searchPages?.pages.flat() ?? []
      return buildImportMerchantOptions([...matchedMerchantByKey.values(), ...searched])
    },
    [matchedMerchantByKey, searchPages],
  )

  return {
    matchedMerchantByKey,
    matchesLoading,
    matchesFailed,
    refetchMatches,
    merchantOptions,
    merchantSearch,
    setMerchantSearch,
    merchantSearchLoading: searchFetching,
    hasMoreMerchantResults: Boolean(hasMoreSearchResults),
    loadMoreMerchantResults: () => void fetchMoreSearchResults(),
  }
}
