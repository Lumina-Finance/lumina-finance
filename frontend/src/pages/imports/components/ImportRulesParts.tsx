import type { ImportRuleRowCount } from '@/api/import-rules'
import {
  IMPORT_INSET_STYLE,
  IMPORT_RULES_LOAD_FAILURE_EXPLANATION,
  IMPORT_RULES_LOAD_FAILURE_TITLE,
  IMPORT_RULES_LOADING_LABEL,
  IMPORT_RULES_NOTICE_TITLE,
} from '@/pages/imports/constants'
import type { ImportRuleCheckState } from '@/pages/imports/types'
import { getImportRuleNoticeLines, getImportRulesFailureReason } from '@/pages/imports/utils/ruleMatching'
import { ImportLoadFailure, ImportNotice } from './Primitives'

/**
 * Lists the import rules that changed rows, each with how many, above the preview's sample
 */
export function ImportRulesNotice({ rules }: { rules: ImportRuleRowCount[] }) {
  const lines = getImportRuleNoticeLines(rules)
  if (lines.length === 0) return null

  return <ImportNotice title={IMPORT_RULES_NOTICE_TITLE} items={lines} />
}

/**
 * Stands in for a part of the import while the rules are asked what they give the rows, or after they
 * could not be, since what the import asks about and shows depends on the answer
 */
export function ImportRulesCheck({ check }: { check: ImportRuleCheckState }) {
  if (check.status === 'failed') {
    const reason = getImportRulesFailureReason(check.error)
    return (
      <ImportLoadFailure
        title={IMPORT_RULES_LOAD_FAILURE_TITLE}
        description={`${reason} ${IMPORT_RULES_LOAD_FAILURE_EXPLANATION}`}
        onRetry={check.onRetry}
      />
    )
  }

  return (
    <div
      role="status"
      className="flex items-center justify-center gap-3 px-4 py-6 text-sm"
      style={{ ...IMPORT_INSET_STYLE, color: 'var(--app-text-muted)' }}
    >
      <span className="app-spinner" aria-hidden />
      {IMPORT_RULES_LOADING_LABEL}
    </div>
  )
}
