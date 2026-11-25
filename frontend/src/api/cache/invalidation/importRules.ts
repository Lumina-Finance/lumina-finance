import type { QueryClient } from '@tanstack/react-query'
import { bankSyncKeys, importRuleKeys } from '@/api/cache/queryKeys'
import { invalidateTargets } from '@/api/cache/invalidation/types'

/**
 * Reads every loaded page of the import rules again from the first, and the count of conditions the
 * rules hold, what they give a file's rows, and the waiting bank items the rules fill in
 *
 * A write that moves rules, or a change to a name a row shows, can't be patched into one page, so
 * a later "Show more" would otherwise repeat or skip a rule. The waiting items keep the values the
 * rules gave them when they arrived, and the list says when the rules or a name they use changed
 * since, so it is read again to offer Reapply updated rules and show the names as they are now
 */
export function invalidateImportRules(queryClient: QueryClient) {
  invalidateTargets(queryClient, [
    { queryKey: importRuleKeys.all },
    { queryKey: importRuleKeys.matchesAll },
    { queryKey: bankSyncKeys.reviewAll },
  ])
}
