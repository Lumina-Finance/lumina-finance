import { fetchImportRuleMatches } from '@/api/import-rules/requests'
import type { ImportRuleMatchesResponse, ImportRuleMatchRow, ImportRuleRowCount } from '@/api/import-rules/types'
import {
  getJsonByteSize,
  getNextArrayItemByteSize,
  MAX_IMPORT_BATCH_ROWS,
  TARGET_IMPORT_BATCH_BYTES,
} from '@/api/shared/importBatchSize'

/**
 * Says the user's rules changed more than once while a file's rows were being checked, so no answer
 * can be trusted to come from one version of them
 */
export class ImportRulesChangedError extends Error {
  constructor() {
    super('The import rules changed while they were being checked.')
    this.name = 'ImportRulesChangedError'
  }
}

/** How many times the check starts over when the rules change under it, before it fails */
const RULES_CHANGED_RESTARTS = 1

/**
 * Splits the rows to ask about into requests that each fit the row count the API takes and the body
 * size the imports keep to
 *
 * A part is closed on both, as the staged import batches are, because a row's note can be long and a
 * count alone could build a body too large to send
 */
export function splitImportRuleMatchRows(rows: ImportRuleMatchRow[]) {
  const emptyBytes = getJsonByteSize({ rows: [] })
  const parts: ImportRuleMatchRow[][] = []
  let part: ImportRuleMatchRow[] = []
  let bytes = emptyBytes

  for (const row of rows) {
    let rowBytes = getNextArrayItemByteSize(part.length, row)
    if (part.length > 0 && (bytes + rowBytes > TARGET_IMPORT_BATCH_BYTES || part.length >= MAX_IMPORT_BATCH_ROWS)) {
      parts.push(part)
      part = []
      bytes = emptyBytes
      rowBytes = getNextArrayItemByteSize(0, row)
    }
    part.push(row)
    bytes += rowBytes
  }
  if (part.length > 0) parts.push(part)
  return parts
}

/**
 * Joins the answers to the parts of one list into the answer to the whole list
 *
 * Each rule's row count adds across the parts. A part lists only the rules that gave something for
 * its rows, in the order the rules are checked, so a rule new to the joined list goes after the rule
 * that came before it in its part. That keeps every part's order in the joined list. Every part is
 * from one version of the rules, and the joined answer carries that version
 */
export function mergeImportRuleMatches(answers: ImportRuleMatchesResponse[]): ImportRuleMatchesResponse {
  const rules: ImportRuleRowCount[] = []
  for (const answer of answers) {
    let insertAt = 0
    for (const count of answer.rules) {
      const known = rules.findIndex((rule) => rule.rule.id === count.rule.id)
      if (known === -1) {
        rules.splice(insertAt, 0, { ...count })
        insertAt += 1
      } else {
        rules[known] = { ...rules[known], row_count: rules[known].row_count + count.row_count }
        insertAt = known + 1
      }
    }
  }
  return { rows: answers.flatMap((answer) => answer.rows), rules, rules_version: answers[0]?.rules_version ?? '' }
}

/**
 * Asks the rules about a list of rows too long for one request, in parts one after the other
 *
 * The answer holds one entry for each row in the order sent. A part answered from another version of
 * the rules than the first part started the check again from the first part, once. A second change
 * fails the check, since the parts could not be told to agree
 *
 * @param signal - Aborts the request when the load that asked for it is abandoned
 */
export async function fetchImportRuleMatchesInBatches(rows: ImportRuleMatchRow[], signal?: AbortSignal) {
  const parts = splitImportRuleMatchRows(rows)

  for (let restart = 0; restart <= RULES_CHANGED_RESTARTS; restart += 1) {
    const answers: ImportRuleMatchesResponse[] = []
    let isChanged = false
    for (const part of parts) {
      const answer = await fetchImportRuleMatches(part, signal)
      if (answers.length > 0 && answer.rules_version !== answers[0].rules_version) {
        isChanged = true
        break
      }
      answers.push(answer)
    }
    if (!isChanged) return mergeImportRuleMatches(answers)
  }
  throw new ImportRulesChangedError()
}

/**
 * Boils rows down to a short text that changes whenever a row does, for a cache key
 *
 * The key must never hold the rows. They say what a statement says, and the saved copy of the cache
 * writes keys out to browser storage. The text is two 32-bit sums over every character of every row,
 * so two lists of the same length do not share it in any case that matters here
 */
export function getImportRuleRowsDigest(rows: ImportRuleMatchRow[]) {
  let first = 0xdeadbeef
  let second = 0x41c6ce57
  for (const row of rows) {
    const text = JSON.stringify(row)
    for (let index = 0; index < text.length; index += 1) {
      const code = text.charCodeAt(index)
      first = Math.imul(first ^ code, 2654435761)
      second = Math.imul(second ^ code, 1597334677)
    }
  }
  first = Math.imul(first ^ (first >>> 16), 2246822507) ^ Math.imul(second ^ (second >>> 13), 3266489909)
  second = Math.imul(second ^ (second >>> 16), 2246822507) ^ Math.imul(first ^ (first >>> 13), 3266489909)
  return `${rows.length}-${(first >>> 0).toString(16)}-${(second >>> 0).toString(16)}`
}
