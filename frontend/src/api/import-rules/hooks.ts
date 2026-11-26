import { useMemo } from 'react'
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { importRuleKeys } from '@/api/cache/queryKeys'
import {
  applyImportRuleMove,
  removeImportRuleCaches,
  restoreImportRules,
  settleImportRuleMove,
  updateImportRuleCreateCaches,
  updateImportRuleUpdateCaches,
} from '@/api/cache/updates/importRules'
import {
  createImportRule,
  deleteImportRule,
  fetchImportRuleBudget,
  fetchImportRulesPage,
  moveImportRule,
  updateImportRule,
} from '@/api/import-rules/requests'
import { getImportRuleCheck, type ImportRuleCheckStatus } from '@/api/import-rules/check'
import { fetchImportRuleMatchesInBatches, getImportRuleRowsDigest } from '@/api/import-rules/matches'
import type { ImportRuleMatchesResponse, ImportRuleMatchRow } from '@/api/import-rules/types'
import { runWithMinimumPendingTime } from '@/api/utils/mutationFeedback'
import { useAuth } from '@/hooks/useAuth'
import { LOADING_ANIMATION_MIN_MS } from '@/utils/timing'

// The check an import waits on is tried once more before it fails, as the held rows check is
const IMPORT_RULE_CHECK_RETRY_COUNT = 1

// An answer is kept this long after the import that asked leaves, so coming back to the same rows
// does not ask again, and no longer, since it holds what the file's rows are called
const IMPORT_RULE_MATCHES_KEEP_MS = 5 * 60 * 1000

/**
 * What an import knows of its check against the user's rules
 *
 * `idle` means nothing is being waited for: there are no rows yet, or the user has no rules to ask
 */
export type ImportRuleCheck = {
  status: ImportRuleCheckStatus
  matches: ImportRuleMatchesResponse | null
  error: unknown
  retry: () => void
}

/**
 * Reads the user's import rules a page at a time, in the order they are checked
 *
 * @param search - Text to find in the rules. Only the rules that hold it are read, kept apart from the whole list
 */
export function useInfiniteImportRules(pageSize = 20, search?: string) {
  const { accessToken } = useAuth()
  return useInfiniteQuery({
    queryKey: search ? importRuleKeys.searched(pageSize, search) : importRuleKeys.infinite(pageSize),
    queryFn: ({ pageParam, signal }) => fetchImportRulesPage(pageSize, pageParam, signal, search),
    initialPageParam: 0,
    getNextPageParam: (lastPage, allPages) => (lastPage.length < pageSize ? undefined : allPages.length * pageSize),
    enabled: !!accessToken,
    staleTime: Infinity,
    gcTime: Infinity,
  })
}

/**
 * Reads how many conditions the user's rules hold, and how many they may hold in all
 *
 * Every create, edit and delete of a rule reads it again, so it is never older than the list
 *
 * @param isWanted - Whether the screen uses the count, so one that doesn't never reads it
 */
export function useImportRuleBudget(isWanted = true) {
  const { accessToken } = useAuth()
  return useQuery({
    queryKey: importRuleKeys.budget(),
    queryFn: ({ signal }) => fetchImportRuleBudget(signal),
    enabled: !!accessToken && isWanted,
    staleTime: Infinity,
    gcTime: Infinity,
  })
}

/**
 * Asks the user's rules what they give the rows an import would save
 *
 * A user with no rules is asked nothing and waited for by nothing, since the count of conditions
 * their rules hold is read first. The answer is held under a digest of the rows and never the rows,
 * and stays out of the saved copy of the cache. It is read again when the rules change, because it
 * names what they give
 *
 * @param rows - The rows the save would send, or null while an answer they depend on is not settled.
 *   The caller keeps the same rows while paused, so the answer held for them stays the one shown
 * @param isPaused - Asks nothing more and keeps the answer held, so an import being saved, or done,
 *   is not asked again about rows it has just written
 */
export function useImportRuleCheck(rows: ImportRuleMatchRow[] | null, isPaused: boolean): ImportRuleCheck {
  const { accessToken } = useAuth()
  const hasRows = rows !== null && rows.length > 0

  const budget = useImportRuleBudget(hasRows)
  const hasRules = budget.data !== undefined && budget.data.used > 0
  const digest = useMemo(() => (rows === null ? '' : getImportRuleRowsDigest(rows)), [rows])
  const matches = useQuery({
    queryKey: importRuleKeys.matches(digest),
    queryFn: ({ signal }) => fetchImportRuleMatchesInBatches(rows ?? [], signal),
    enabled: !!accessToken && hasRows && hasRules && !isPaused,
    staleTime: Infinity,
    gcTime: IMPORT_RULE_MATCHES_KEEP_MS,
    retry: IMPORT_RULE_CHECK_RETRY_COUNT,

    // The rows are checked against the rules as they are now, and the answer can be big
    refetchOnMount: 'always',
    structuralSharing: false,
  })

  const { failedRead, ...state } = getImportRuleCheck({ hasRows, isPaused, budget, matches })
  return {
    ...state,
    retry: () => void (failedRead === 'budget' ? budget.refetch() : matches.refetch()),
  }
}

/**
 * Creates a rule at the bottom of the list
 */
export function useCreateImportRule() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (payload: Parameters<typeof createImportRule>[0]) =>
      runWithMinimumPendingTime(LOADING_ANIMATION_MIN_MS, () => createImportRule(payload)),
    onSuccess: () => updateImportRuleCreateCaches(queryClient),
  })
}

/**
 * Saves the changed fields of a rule
 */
export function useUpdateImportRule() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (request: Parameters<typeof updateImportRule>[0]) =>
      runWithMinimumPendingTime(LOADING_ANIMATION_MIN_MS, () => updateImportRule(request)),
    onSuccess: (rule) => updateImportRuleUpdateCaches(queryClient, rule),
  })
}

/**
 * Deletes a rule, taking it out of the loaded pages and reading them again
 */
export function useDeleteImportRule() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (ruleId: string) => runWithMinimumPendingTime(LOADING_ANIMATION_MIN_MS, () => deleteImportRule(ruleId)),
    onSuccess: (_, ruleId) => removeImportRuleCaches(queryClient, ruleId),
  })
}

/**
 * Moves a rule, showing the new order at once and putting the old one back if the server refuses
 *
 * Whichever way the answer goes, every loaded page is read again from the first, so a later "Show
 * more" neither repeats nor skips a rule
 */
export function useMoveImportRule() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: moveImportRule,
    onMutate: async ({ ruleId, position }) => {
      // A read begun before the move would land after it and put the old order back
      await queryClient.cancelQueries({ queryKey: importRuleKeys.infiniteAll })
      return { previous: applyImportRuleMove(queryClient, ruleId, position) }
    },
    onError: (_error, _request, context) => {
      if (context) restoreImportRules(queryClient, context.previous)
    },
    onSettled: () => settleImportRuleMove(queryClient),
  })
}
