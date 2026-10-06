import type { LastImport } from '@/api/import-runs'
import { joinWords } from '@/pages/imports/utils/common'

/** How the last import names the app it came from */
export const IMPORT_SOURCE_LABELS: Record<LastImport['source'], string> = {
  generic: 'CSV',
  firefly: 'Firefly III',
  actual_budget: 'Actual Budget',
}

/** Shown for an import saved without a file name */
export const UNNAMED_IMPORT_FILE = 'Unnamed file'

/**
 * Counts transactions in words, with the singular for one, kept on one line with its number
 */
export function formatTransactionCount(count: number) {
  return `${count.toLocaleString()}\u00a0${count === 1 ? 'transaction' : 'transactions'}`
}

/**
 * Says everything undoing an import deletes: its transactions and every record it created
 *
 * @param entry - The import about to be undone
 */
export function describeUndoDeletion(entry: LastImport) {
  const parts = [
    formatTransactionCount(entry.transaction_count),
    countWord(entry.account_count, 'account', 'accounts'),
    countWord(entry.category_count, 'category', 'categories'),
    countWord(entry.merchant_count, 'merchant', 'merchants'),
    countWord(entry.tag_count, 'tag', 'tags'),
    countWord(entry.budget_count, 'budget', 'budgets'),
  ].filter((part): part is string => part !== null)

  return `This deletes everything ${entry.file_name ?? 'this import'} added: ${joinWords(parts)}.`
}

function countWord(count: number, singular: string, plural: string) {
  return count > 0 ? `${count.toLocaleString()}\u00a0${count === 1 ? singular : plural}` : null
}
