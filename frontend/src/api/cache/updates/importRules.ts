import type { InfiniteData, QueryClient } from '@tanstack/react-query'
import { invalidateImportRules } from '@/api/cache/invalidation'
import { importRuleKeys } from '@/api/cache/queryKeys'
import { moveImportRuleInList, numberImportRules } from '@/api/import-rules/order'
import type { ImportRule } from '@/api/import-rules/types'

type RulePages = InfiniteData<ImportRule[]>

/**
 * Puts a changed rule into every loaded page that holds it
 */
function replaceRule(data: RulePages | undefined, rule: ImportRule): RulePages | undefined {
  if (!data) return data
  return { ...data, pages: data.pages.map((page) => page.map((row) => (row.id === rule.id ? rule : row))) }
}

/**
 * Takes a rule out of the loaded pages and closes the gap it leaves in the positions
 */
function withoutRule(data: RulePages | undefined, ruleId: string): RulePages | undefined {
  if (!data) return data
  const rows = data.pages.flat()
  if (!rows.some((row) => row.id === ruleId)) return data
  return rechunk(
    data,
    rows.filter((row) => row.id !== ruleId),
  )
}

/**
 * Takes a rule out of the loaded pages of a search, leaving the places the other rules hold
 *
 * A search shows only some of the rules, so a place is the rule's place among all of them and never among the rows
 * shown. The read that follows brings the pages back in full
 */
function withoutSearchedRule(data: RulePages | undefined, ruleId: string): RulePages | undefined {
  if (!data) return data
  return { ...data, pages: data.pages.map((page) => page.filter((row) => row.id !== ruleId)) }
}

/**
 * Lays rows out again in the pages they came in, numbering their positions from zero
 *
 * Loaded pages always start at the first, so a row's place in the list is its place among the rows
 * loaded. A page keeps as many rows as it held, so a removed row leaves the last page one short
 */
function rechunk(data: RulePages, rows: ImportRule[]): RulePages {
  const numbered = numberImportRules(rows)
  let start = 0
  const pages = data.pages.map((page) => {
    const next = numbered.slice(start, start + page.length)
    start += page.length
    return next
  })
  return { ...data, pages }
}

/**
 * Moves a rule to a place among the loaded rows, or returns the pages as they are when the place is
 * past them
 *
 * A place beyond the loaded rows is not one this list can show yet, and putting the rule at the end
 * of them would show it somewhere it isn't, so the caller leaves those to the read that follows
 *
 * @param position - Where the rule should end up, counted from zero
 */
export function moveRuleInPages(data: RulePages | undefined, ruleId: string, position: number): RulePages | undefined {
  if (!data) return data
  const rows = data.pages.flat()
  const moved = moveImportRuleInList(rows, ruleId, position)
  return moved === rows ? data : rechunk(data, moved)
}

/**
 * Refreshes the rules list after a rule is created. A new rule goes last
 */
export function updateImportRuleCreateCaches(queryClient: QueryClient) {
  invalidateImportRules(queryClient)
}

/**
 * Shows an edited rule in the list at once, then reads the list again for the names and the
 * account notes the response was worked out against, and the count of conditions the rules hold
 */
export function updateImportRuleUpdateCaches(queryClient: QueryClient, rule: ImportRule) {
  queryClient.setQueriesData<RulePages>({ queryKey: importRuleKeys.infiniteAll }, (data) => replaceRule(data, rule))
  queryClient.setQueriesData<RulePages>({ queryKey: importRuleKeys.searchedAll }, (data) => replaceRule(data, rule))
  invalidateImportRules(queryClient)
}

/**
 * Takes a deleted rule out of the loaded pages, then reads them again from the first
 */
export function removeImportRuleCaches(queryClient: QueryClient, ruleId: string) {
  queryClient.setQueriesData<RulePages>({ queryKey: importRuleKeys.infiniteAll }, (data) => withoutRule(data, ruleId))
  queryClient.setQueriesData<RulePages>({ queryKey: importRuleKeys.searchedAll }, (data) =>
    withoutSearchedRule(data, ruleId),
  )
  invalidateImportRules(queryClient)
}

/**
 * Shows a move before the server has answered, returning what each list held so a refusal can put
 * it back
 */
export function applyImportRuleMove(queryClient: QueryClient, ruleId: string, position: number) {
  const previous = queryClient.getQueriesData<RulePages>({ queryKey: importRuleKeys.infiniteAll })
  queryClient.setQueriesData<RulePages>({ queryKey: importRuleKeys.infiniteAll }, (data) =>
    moveRuleInPages(data, ruleId, position),
  )
  return previous
}

/**
 * Puts back the lists a refused move changed
 */
export function restoreImportRules(queryClient: QueryClient, previous: ReturnType<typeof applyImportRuleMove>) {
  for (const [queryKey, data] of previous) queryClient.setQueryData(queryKey, data)
}

/**
 * Reads the rules again from the first page once a move has been answered, whichever way
 */
export function settleImportRuleMove(queryClient: QueryClient) {
  invalidateImportRules(queryClient)
}
