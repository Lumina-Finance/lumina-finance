import { useInfiniteTags, type Tag } from '@/api/tags'
import { usePaginatedSettingsList } from '@/pages/settings/components/shared/hooks/usePaginatedSettingsList'
import {
  TAG_LIST_PAGE_SIZE,
  TAG_LIST_VISIBLE_ROWS,
  TAG_SEARCH_DEBOUNCE_MS,
} from '@/pages/settings/components/tag-settings-section/constants'

/**
 * Drives the paginated, searchable tag list on top of the shared settings-list hook, sorting
 * each fetched page alphabetically before it is compared against what is on screen
 *
 * Rows key on id alone, since a tag's name only ever changes through a rename that already
 * triggers its own refetch
 */
export function useTagSettingsList(locallyDeletedTagIds: string[]) {
  const {
    activeSearch,
    error,
    handleListMoreClick,
    handleListScroll,
    hasMore,
    isError,
    listRef,
    search,
    setActiveSearch,
    setSearch,
    setVisibleItems,
    shouldScroll,
    showFetchingMore,
    showInitialLoading,
    showListEnd,
    showListMoreIndicator,
    visibleItems,
  } = usePaginatedSettingsList({
    useInfiniteListQuery: useInfiniteTags,
    pageSize: TAG_LIST_PAGE_SIZE,
    visibleRowCount: TAG_LIST_VISIBLE_ROWS,
    searchDebounceMs: TAG_SEARCH_DEBOUNCE_MS,
    locallyDeletedIds: locallyDeletedTagIds,
    getItemIdentityKey: (tag: Tag) => [tag.id],
    sortFetchedItems: (tags: Tag[]) => tags.slice().sort((a, b) => a.name.localeCompare(b.name)),
  })

  return {
    activeSearch,
    handleTagListMoreClick: handleListMoreClick,
    handleTagListScroll: handleListScroll,
    hasMoreTags: hasMore,
    search,
    setActiveSearch,
    setSearch,
    setVisibleTags: setVisibleItems,
    shouldScrollTags: shouldScroll,
    showFetchingMoreTags: showFetchingMore,
    showInitialTagLoading: showInitialLoading,
    showTagListEnd: showListEnd,
    showTagListMoreIndicator: showListMoreIndicator,
    tagListError: error,
    tagListFailed: isError,
    tagListRef: listRef,
    visibleTags: visibleItems,
  }
}
