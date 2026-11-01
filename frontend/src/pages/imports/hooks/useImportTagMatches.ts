import { useCallback, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { fetchTagNameMatches, useInfiniteTags, type Tag } from '@/api/tags'
import { tagKeys } from '@/api/cache/queryKeys'
import { getNameKey } from '@/api/shared/nameKey'
import { useAuth } from '@/hooks/useAuth'
import { buildImportTagOptions } from '@/pages/imports/utils'

// Tags one search page holds, matching what the transaction modal's own tag search uses
const TAG_SEARCH_PAGE_SIZE = 20

/**
 * Loads which of a file's tag names already have a tag, and drives the search a user runs to point
 * one at a tag the file never mentions
 *
 * The page asks about the file rather than holding every tag, since the list endpoint answers a
 * page at a time. The search is shared by every row, so a step listing hundreds of values still
 * runs one search query at a time
 *
 * @param importedTags - One tag name per tag the file resolves to
 */
export function useImportTagMatches(importedTags: string[]) {
  const { accessToken } = useAuth()
  const [tagSearch, setTagSearch] = useState('')

  const {
    data: matches = [],
    isLoading: tagMatchesLoading,
    isError: tagMatchesFailed,
    refetch: refetchTagMatches,
  } = useQuery({
    queryKey: tagKeys.nameMatches(importedTags),
    queryFn: ({ signal }) => fetchTagNameMatches(importedTags, signal),
    enabled: Boolean(accessToken) && importedTags.length > 0,
  })

  const trimmedSearch = tagSearch.trim()
  const {
    data: searchPages,
    isFetching: searchFetching,
    hasNextPage: hasMoreSearchResults,
    fetchNextPage: fetchMoreSearchResults,
  } = useInfiniteTags({ q: trimmedSearch }, TAG_SEARCH_PAGE_SIZE, Boolean(accessToken) && trimmedSearch.length > 0)

  const matchedTagByKey = useMemo(
    () => new Map(matches.map((match) => [getNameKey(match.source), match.tag])),
    [matches],
  )

  // What a tag picked through the search is called, remembered as it is picked. Closing the
  // dropdown clears the search, which empties the results it was chosen from, and the row would
  // then read as unanswered while holding the right answer, its option having gone with them
  const [pickedTagLabels, setPickedTagLabels] = useState<Record<string, string>>({})

  const rememberPickedTag = useCallback((tagId: string, label: string) => {
    setPickedTagLabels((current) => (current[tagId] ? current : { ...current, [tagId]: label }))
  }, [])

  const tagOptions = useMemo(() => {
    // Only the user's own tags are offered, since an import never files rows under a group's
    const searched: Tag[] = (searchPages?.pages.flat() ?? []).filter((tag) => tag.group_id === null)
    return buildImportTagOptions([...matchedTagByKey.values(), ...searched], pickedTagLabels)
  }, [matchedTagByKey, pickedTagLabels, searchPages])

  return {
    matchedTagByKey,
    tagMatchesLoading,
    tagMatchesFailed,
    refetchTagMatches,
    tagOptions,
    rememberPickedTag,
    tagSearch,
    setTagSearch,
    tagSearchLoading: searchFetching,
    hasMoreTagResults: Boolean(hasMoreSearchResults),
    loadMoreTagResults: () => void fetchMoreSearchResults(),
  }
}
