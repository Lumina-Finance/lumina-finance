import { ApiError } from '@/api/auth'
import type { Category } from '@/api/categories'
import {
  ImportRulesChangedError,
  type ImportRuleCheck,
  type ImportRuleMatchesResponse,
  type ImportRuleRowCount,
  type ImportRuleRowMatch,
} from '@/api/import-rules'
import { getNameKey } from '@/api/shared/nameKey'
import type { ImportCommitCheck } from '@/pages/imports/components'
import {
  getImportRuleChangeLine,
  IMPORT_RULES_CHANGED_REASON,
  IMPORT_RULES_CHECK_FAILED_MESSAGE,
  IMPORT_RULES_LOADING_LABEL,
  IMPORT_RULES_REFUSED_REASON,
  MAX_IMPORT_TAGS_PER_ROW,
} from '@/pages/imports/constants'
import type { ImportRuleCheckState, ImportRuleMatchLookup, ImportRuleRow } from '@/pages/imports/types'
import { getLoadFailureReason } from '@/pages/imports/utils/loadFailureReason'

/**
 * Says why the rules check failed, as the first sentence of its failure panel
 *
 * The rules changing while the parts of a long check were asked, and the server refusing the check
 * because a rule or a record it names changed meanwhile, read the same. The server's own sentence for
 * that ends by asking the user to try again, and the panel's button already asks
 */
export function getImportRulesFailureReason(error: unknown): string {
  const isChanged = error instanceof ImportRulesChangedError || (error instanceof ApiError && error.status === 409)
  return isChanged ? IMPORT_RULES_CHANGED_REASON : getLoadFailureReason(error, IMPORT_RULES_REFUSED_REASON)
}

/**
 * Pairs the rules' answer with the rows it was asked for, by the row's identity
 *
 * The answer holds one entry for each row in the order the rows were sent, so the rows must be the
 * ones that were sent. Null while the rules have not answered
 */
export function indexImportRuleMatches(
  rows: ImportRuleRow[],
  answer: ImportRuleMatchesResponse | null,
): ImportRuleMatchLookup | null {
  if (!answer) return null

  const lookup: ImportRuleMatchLookup = new Map()
  rows.forEach((row, index) => {
    const match = answer.rows[index]
    if (match) lookup.set(row.id, match)
  })
  return lookup
}

/**
 * Finds the merchant names whose every row takes a rule's merchant, so the import has nothing to
 * ask about and creates no merchant for them
 *
 * Names group as the save groups them, by the name with its capitals folded, so "Market" and
 * "MARKET" are one name. A name with one row no rule gives a merchant stays a question, and so does
 * a name no row of the import carries, since the rows decide
 *
 * @param rows - The rows the save would send, the ones the rules were asked about
 * @returns The keys the names are matched under, as the merchant step matches them
 */
export function getRuleCoveredMerchantKeys(rows: ImportRuleRow[], lookup: ImportRuleMatchLookup | null) {
  if (!lookup) return new Set<string>()

  const isCovered = new Map<string, boolean>()
  for (const row of rows) {
    const name = row.request.description
    if (!name) continue

    const key = getNameKey(name)
    isCovered.set(key, (isCovered.get(key) ?? true) && Boolean(lookup.get(row.id)?.merchant))
  }
  return new Set([...isCovered].filter(([, covered]) => covered).map(([key]) => key))
}

/**
 * Names the rules behind each merchant name they cover, in the order the names are listed
 *
 * @param names - The merchant names the file holds, one for each spelling
 * @param coveredKeys - The keys of the merchant names the rules cover
 */
export function getRuleCoveredMerchants(
  names: string[],
  rows: ImportRuleRow[],
  lookup: ImportRuleMatchLookup | null,
  coveredKeys: Set<string>,
) {
  const ruleNamesByKey = new Map<string, Set<string>>()
  for (const row of rows) {
    const ruleName = lookup?.get(row.id)?.merchant?.rule.name
    if (!row.request.description || !ruleName) continue

    const key = getNameKey(row.request.description)
    ruleNamesByKey.set(key, (ruleNamesByKey.get(key) ?? new Set()).add(ruleName))
  }

  return names
    .filter((name) => coveredKeys.has(getNameKey(name)))
    .map((name) => ({ name, ruleNames: [...(ruleNamesByKey.get(getNameKey(name)) ?? [])] }))
}

/**
 * Leaves out the names whose rows the rules take over
 *
 * @param names - The names a step asks about
 * @param coveredKeys - The keys of the names the rules cover
 */
export function leaveOutCoveredNames(names: string[], coveredKeys: Set<string>) {
  return coveredKeys.size === 0 ? names : names.filter((name) => !coveredKeys.has(getNameKey(name)))
}

/**
 * Works out what a previewed row shows where the rules give it values
 *
 * Each value is present only where a rule gives it, so the caller keeps what the file gives for the
 * rest. A rule's tags are added to the file's, and its category is looked up among the categories the
 * page holds, since the answer names it without its kind
 *
 * @param categoryById - The categories the page holds
 */
export function getRulePreviewValues(match: ImportRuleRowMatch | undefined, categoryById: Map<string, Category>) {
  return {
    merchantName: match?.merchant?.name,
    category: match?.category ? categoryById.get(match.category.id) : undefined,
    tagNames: match?.tags.map((tag) => tag.name) ?? [],
  }
}

/**
 * Adds the tags the rules give a row to the tags the file gives it, each tag once
 *
 * @param fileTagNames - The names the row shows from the file, after the tag step's answers
 */
export function addRuleTagNames(fileTagNames: string[], ruleTagNames: string[]) {
  const shown = new Set(fileTagNames.map(getNameKey))
  return [...fileTagNames, ...ruleTagNames.filter((name) => !shown.has(getNameKey(name)))]
}

/**
 * Says how many tags the rules leave a row with when that is more than a transaction carries, or null
 *
 * The count is the file's tags and the rules' together. The save refuses such a row, so the import
 * names it and leaves it out, as it does a row whose file alone gives too many
 */
export function getRuleTagCountOverLimit(match: ImportRuleRowMatch | undefined): number | null {
  return match && match.tag_count > MAX_IMPORT_TAGS_PER_ROW ? match.tag_count : null
}

/**
 * Counts, for each rule, the rows the save will send where the rule supplied a value the row ends with
 *
 * The rules' own counts take in every row the check was asked about, including a row the import then
 * leaves out, so the notice is counted again from the rows sent. A rule left with no row is dropped
 *
 * @param rules - The rules that gave something, first checked first
 * @param sentRows - The rows the save will send
 */
export function countRuleRowsSent(
  rules: ImportRuleRowCount[],
  sentRows: ImportRuleRow[],
  lookup: ImportRuleMatchLookup | null,
): ImportRuleRowCount[] {
  if (!lookup) return []

  const rowCountByRule = new Map<string, number>()
  for (const { id } of sentRows) {
    const match = lookup.get(id)
    if (!match) continue

    const ruleIds = new Set(
      [match.merchant, match.category, ...match.tags].flatMap((given) => (given ? [given.rule.id] : [])),
    )
    for (const ruleId of ruleIds) rowCountByRule.set(ruleId, (rowCountByRule.get(ruleId) ?? 0) + 1)
  }

  return rules
    .map(({ rule }) => ({ rule, row_count: rowCountByRule.get(rule.id) ?? 0 }))
    .filter(({ row_count: rowCount }) => rowCount > 0)
}

/** Lists what the notice above the preview says: each rule that changed rows with its row count, in the order the rules are checked */
export function getImportRuleNoticeLines(rules: ImportRuleRowCount[]) {
  return rules.map(({ rule, row_count: rowCount }) => getImportRuleChangeLine(rule.name, rowCount))
}

/**
 * Works out what the import shows of the rules check: the stand-in over the parts that wait for it and
 * the notice that holds the commit button
 *
 * Both follow the check as it shows on screen. It stays up for a moment after the answer arrives, so
 * the import is held for exactly as long as the stand-in shows and the button never invites a commit
 * beside a check that still looks to be running
 *
 * @param check - The check itself
 * @param isShown - Whether a finished check is still held on screen
 */
export function getImportRuleCheckDisplay(
  check: Pick<ImportRuleCheck, 'status' | 'error' | 'retry'>,
  isShown: boolean,
): { state: ImportRuleCheckState | null; notice: ImportCommitCheck | null } {
  const shownStatus = check.status === 'loading' || (isShown && check.status !== 'failed') ? 'loading' : check.status
  if (shownStatus !== 'loading' && shownStatus !== 'failed') return { state: null, notice: null }

  const isLoading = shownStatus === 'loading'
  return {
    state: { status: shownStatus, error: check.error, onRetry: check.retry },
    notice: {
      state: isLoading ? 'running' : 'failed',
      message: isLoading ? IMPORT_RULES_LOADING_LABEL : IMPORT_RULES_CHECK_FAILED_MESSAGE,
    },
  }
}
