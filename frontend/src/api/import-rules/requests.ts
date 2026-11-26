import { authenticatedFetch } from '@/api/client'
import { buildQueryString } from '@/api/utils/queryString'
import type {
  CreateImportRulePayload,
  ImportRule,
  ImportRuleBudget,
  ImportRuleMatchesResponse,
  ImportRuleMatchRow,
  MoveImportRuleRequest,
  UpdateImportRuleRequest,
} from '@/api/import-rules/types'

/**
 * Asks the rules what they would give some file rows, saving nothing
 *
 * The rows travel in the body only, so no URL or cache key holds what a statement says
 *
 * @param rows - At most one batch of an import
 * @param signal - Aborts the request when the load that asked for it is abandoned
 */
export function fetchImportRuleMatches(rows: ImportRuleMatchRow[], signal?: AbortSignal) {
  return authenticatedFetch<ImportRuleMatchesResponse>('/import-rules/matches', {
    method: 'POST',
    body: JSON.stringify({ rows }),
    signal,
  })
}

/**
 * Fetches one page of the user's import rules, in the order they are checked
 *
 * @param signal - Aborts the request when the load that asked for it is abandoned
 * @param search - Text to find in the rules, so only the rules that hold it come back, still in order
 */
export function fetchImportRulesPage(pageSize: number, offset = 0, signal?: AbortSignal, search?: string) {
  return authenticatedFetch<ImportRule[]>('/import-rules' + buildQueryString({ limit: pageSize, offset, q: search }), {
    signal,
  })
}

/**
 * Fetches the conditions the user's rules may hold together, and how many they hold
 *
 * @param signal - Aborts the request when the load that asked for it is abandoned
 */
export function fetchImportRuleBudget(signal?: AbortSignal) {
  return authenticatedFetch<ImportRuleBudget>('/import-rules/budget', { signal })
}

/**
 * Creates a rule at the bottom of the list
 */
export function createImportRule(payload: CreateImportRulePayload) {
  return authenticatedFetch<ImportRule>('/import-rules', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

/**
 * Updates the fields of a rule that are sent
 */
export function updateImportRule({ ruleId, payload }: UpdateImportRuleRequest) {
  return authenticatedFetch<ImportRule>(`/import-rules/${ruleId}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  })
}

/**
 * Moves a rule to a place in the order, counted from zero
 */
export function moveImportRule({ ruleId, position }: MoveImportRuleRequest) {
  return authenticatedFetch<ImportRule>(`/import-rules/${ruleId}/position`, {
    method: 'PUT',
    body: JSON.stringify({ position }),
  })
}

/**
 * Deletes a rule, closing the gap it leaves in the order
 */
export function deleteImportRule(ruleId: string) {
  return authenticatedFetch<void>(`/import-rules/${ruleId}`, { method: 'DELETE' })
}
