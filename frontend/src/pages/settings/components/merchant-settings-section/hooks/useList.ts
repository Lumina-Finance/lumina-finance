import { useInfiniteMerchants, type Merchant } from '@/api/merchants'
import { usePaginatedSettingsList } from '@/pages/settings/components/shared/hooks/usePaginatedSettingsList'
import {
  MERCHANT_LIST_PAGE_SIZE,
  MERCHANT_LIST_VISIBLE_ROWS,
  MERCHANT_SEARCH_DEBOUNCE_MS,
} from '@/pages/settings/components/merchant-settings-section/constants'

/**
 * Drives the paginated, searchable merchant list on top of the shared settings-list hook
 *
 * Rows key on id, name and default category together, rather than id alone, so an inline edit
 * that changes the name or default category re-reveals the row instead of leaving it showing
 * stale text until the next unrelated refetch. The server's own order, recent usage then name,
 * is left untouched: re-sorting here would interleave each new page among the loaded rows and
 * reshuffle the list on every load
 */
export function useMerchantSettingsList(locallyDeletedMerchantIds: string[]) {
  const {
    activeSearch,
    handleListMoreClick,
    handleListScroll,
    hasMore,
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
    useInfiniteListQuery: useInfiniteMerchants,
    pageSize: MERCHANT_LIST_PAGE_SIZE,
    visibleRowCount: MERCHANT_LIST_VISIBLE_ROWS,
    searchDebounceMs: MERCHANT_SEARCH_DEBOUNCE_MS,
    locallyDeletedIds: locallyDeletedMerchantIds,
    getItemIdentityKey: (merchant: Merchant) => [merchant.id, merchant.name, merchant.default_category_id],
  })

  return {
    activeSearch,
    handleMerchantListMoreClick: handleListMoreClick,
    handleMerchantListScroll: handleListScroll,
    hasMoreMerchants: hasMore,
    search,
    setActiveSearch,
    setSearch,
    setVisibleMerchants: setVisibleItems,
    shouldScrollMerchants: shouldScroll,
    showFetchingMoreMerchants: showFetchingMore,
    showInitialMerchantLoading: showInitialLoading,
    showMerchantListEnd: showListEnd,
    showMerchantListMoreIndicator: showListMoreIndicator,
    merchantListRef: listRef,

    // Merchants that ship with the app cannot be renamed, deleted or merged, so settings leaves
    // them out rather than showing rows whose every control is refused. They are still offered
    // when picking one on a transaction, which is the only place they are meant to be used.
    // Filtered here rather than in the query, so a page holding one comes back a row short
    visibleMerchants: visibleItems.filter((merchant: Merchant) => !merchant.is_system),
  }
}
