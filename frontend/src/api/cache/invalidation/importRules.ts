import type { QueryClient } from '@tanstack/react-query'
import { importRuleKeys } from '@/api/cache/queryKeys'
import { invalidateTargets } from '@/api/cache/invalidation/types'

/**
 * Reads every loaded page of the import rules again from the first, and the count of conditions the
 * rules hold, and what they give a file's rows
 *
 * A write that moves rules, or a change to a name a row shows, can't be patched into one page, so
 * a later "Show more" would otherwise repeat or skip a rule
 */
export function invalidateImportRules(queryClient: QueryClient) {
  invalidateTargets(queryClient, [{ queryKey: importRuleKeys.all }, { queryKey: importRuleKeys.matchesAll }])
}
