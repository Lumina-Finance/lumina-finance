import { useInfiniteImportRules, type ImportRule } from '@/api/import-rules'
import {
  RULE_LIST_PAGE_SIZE,
  RULE_LIST_VISIBLE_ROWS,
  RULE_SEARCH_DEBOUNCE_MS,
} from '@/pages/settings/components/import-rules-section/constants'
import { usePaginatedSettingsList } from '@/pages/settings/components/shared/hooks/usePaginatedSettingsList'

/**
 * Reads the rules for the shared hook, with the text it passes as the search. The shared hook holds a page asked for
 * while the loaded pages are read again after a move or a delete, and asks for it once that read ends
 */
function useRulesQuery(filters: { q?: string }, pageSize: number) {
  return useInfiniteImportRules(pageSize, filters.q)
}

const sortByPosition = (rules: ImportRule[]) => rules.slice().sort((a, b) => a.position - b.position)

/**
 * The text a row shows, so a change to any of it replaces the row on screen. A move changes the
 * position, an edit changes the rest, and a rename elsewhere changes the names the response carries
 */
function getRuleIdentityKey(rule: ImportRule): readonly unknown[] {
  return [
    rule.id,
    rule.position,
    rule.updated_at,
    rule.name,
    rule.merchant?.name,
    rule.category?.name,
    rule.tags.map((tag) => tag.name),
    JSON.stringify(rule.conditions),
  ]
}

/**
 * Drives the import rules list on top of the shared settings-list hook, in the order the rules are
 * checked
 *
 * The rows are sorted by position only, and the key that tells rows apart includes the position, so a
 * move the cache shows at once replaces what is on screen
 */
export function useImportRulesList(locallyDeletedRuleIds: string[]) {
  const list = usePaginatedSettingsList({
    useInfiniteListQuery: useRulesQuery,
    pageSize: RULE_LIST_PAGE_SIZE,
    visibleRowCount: RULE_LIST_VISIBLE_ROWS,
    searchDebounceMs: RULE_SEARCH_DEBOUNCE_MS,
    locallyDeletedIds: locallyDeletedRuleIds,
    getItemIdentityKey: getRuleIdentityKey,
    sortFetchedItems: sortByPosition,
  })

  return {
    activeSearch: list.activeSearch,
    search: list.search,
    setActiveSearch: list.setActiveSearch,
    setSearch: list.setSearch,
    handleRuleListMoreClick: list.handleListMoreClick,
    handleRuleListScroll: list.handleListScroll,
    hasMoreRules: list.hasMore,
    ruleListError: list.error,
    ruleListFailed: list.isError,
    ruleListRef: list.listRef,
    setVisibleRules: list.setVisibleItems,
    shouldScrollRules: list.shouldScroll,
    showFetchingMoreRules: list.showFetchingMore,
    showInitialRuleLoading: list.showInitialLoading,
    showRuleListEnd: list.showListEnd,
    showRuleListMoreIndicator: list.showListMoreIndicator,
    visibleRules: list.visibleItems,
  }
}
