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
import { runWithMinimumPendingTime } from '@/api/utils/mutationFeedback'
import { useAuth } from '@/hooks/useAuth'
import { LOADING_ANIMATION_MIN_MS } from '@/utils/timing'

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
 */
export function useImportRuleBudget() {
  const { accessToken } = useAuth()
  return useQuery({
    queryKey: importRuleKeys.budget(),
    queryFn: ({ signal }) => fetchImportRuleBudget(signal),
    enabled: !!accessToken,
    staleTime: Infinity,
    gcTime: Infinity,
  })
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
