import type { ImportRuleBudget, ImportRuleMatchesResponse } from '@/api/import-rules/types'

/** What an import knows of its check against the user's rules. `idle` means nothing is waited for */
export type ImportRuleCheckStatus = 'idle' | 'loading' | 'ready' | 'failed'

type CheckInputs = {
  /** Whether the import has rows to ask about */
  hasRows: boolean

  /** Whether the import is being saved or is done, so it keeps whatever answer it has */
  isPaused: boolean

  /** The count of conditions the user's rules hold, so none means there are no rules */
  budget: { data: ImportRuleBudget | undefined; isError: boolean; error: unknown }
  matches: {
    data: ImportRuleMatchesResponse | undefined
    isFetching: boolean
    isPending: boolean
    isError: boolean
    error: unknown
  }
}

type CheckState = {
  status: ImportRuleCheckStatus
  matches: ImportRuleMatchesResponse | null
  error: unknown

  /** Which read to ask again when the check fails */
  failedRead: 'budget' | 'matches' | null
}

const IDLE: CheckState = { status: 'idle', matches: null, error: null, failedRead: null }
const LOADING: CheckState = { status: 'loading', matches: null, error: null, failedRead: null }

/**
 * Settles what an import waits for from what its two reads say
 *
 * A user with no rules is waited for by nothing, so the count of conditions comes first. Until it
 * answers the import waits, and if it can't be read the import can't tell whether rules apply, so it
 * fails like a check that couldn't finish. While an import is being saved or is done, an answer held
 * from before is kept as it is, and none held leaves nothing to wait for
 */
export function getImportRuleCheck({ hasRows, isPaused, budget, matches }: CheckInputs): CheckState {
  if (!hasRows) return IDLE
  if (budget.data === undefined) {
    return budget.isError ? { status: 'failed', matches: null, error: budget.error, failedRead: 'budget' } : LOADING
  }
  if (budget.data.used === 0) return IDLE
  if (isPaused && matches.data === undefined) return IDLE
  if (matches.isFetching || matches.isPending) return LOADING
  if (matches.isError) return { status: 'failed', matches: null, error: matches.error, failedRead: 'matches' }
  return { status: 'ready', matches: matches.data ?? null, error: null, failedRead: null }
}
