import { useMemo, useState } from 'react'
import { useImportRuleCheck, type ImportRuleRowCount } from '@/api/import-rules'
import { useMinimumVisibleFlag } from '@/hooks/useMinimumVisibleFlag'
import type { ImportRuleRow } from '@/pages/imports/types'
import { getImportRuleCheckDisplay, indexImportRuleMatches } from '@/pages/imports/utils/ruleMatching'
import { LOADING_ANIMATION_MIN_MS } from '@/utils/timing'

const NO_RULE_COUNTS: ImportRuleRowCount[] = []
const NO_RULE_ROWS: ImportRuleRow[] = []

/**
 * Asks the user's import rules what they give the rows an import would save, and says what the
 * import shows and waits for while they answer
 *
 * The rows are held as they were when the import started saving, so the answer a finished import
 * shows is the one it was saved with, and the rows keep the identities the answer is read by. A user
 * with no rules is asked nothing and waited for by nothing
 *
 * @param liveRows - The rows the save would send, or null while an answer they depend on is not settled
 * @param isPaused - Whether the import is being saved or is done
 */
export function useImportRulesCheck(liveRows: ImportRuleRow[] | null, isPaused: boolean) {
  const [rows, setRows] = useState(liveRows)
  if (!isPaused && rows !== liveRows) setRows(liveRows)

  const requests = useMemo(() => (rows ? rows.map((row) => row.request) : null), [rows])
  const check = useImportRuleCheck(requests, isPaused)
  const lookup = useMemo(() => indexImportRuleMatches(rows ?? NO_RULE_ROWS, check.matches), [check.matches, rows])

  // The check stays on screen for a moment after it finishes, so it does not flash past
  const isCheckShown = useMinimumVisibleFlag(check.status === 'loading', LOADING_ANIMATION_MIN_MS)
  const { state, notice } = getImportRuleCheckDisplay(check, isCheckShown)

  return {
    /** The rows the answer is for, the ones asked about */
    ruleRows: rows ?? NO_RULE_ROWS,

    /** What the rules give each row, null until they have answered */
    ruleMatches: lookup,
    ruleCheckState: state,
    ruleCheckNotice: notice,

    /** Each rule that changed rows with how many, first checked first */
    ruleCounts: check.matches?.rules ?? NO_RULE_COUNTS,
  }
}
