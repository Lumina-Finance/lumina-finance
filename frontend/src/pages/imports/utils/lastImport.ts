import type { LastImport } from '@/api/import-runs'
import { formatList } from '@/utils/formatList'

/** How the last import names the app it came from */
export const IMPORT_SOURCE_LABELS: Record<LastImport['source'], string> = {
  generic: 'CSV',
  firefly: 'Firefly III',
  actual_budget: 'Actual Budget',
  ofx: 'OFX/QFX',
  qif: 'QIF',
}

/** Shown for an import saved without a file name */
export const UNNAMED_IMPORT_FILE = 'Unnamed file'

/** Said when the importer that ran the undone import is open again with its files and answers */
export const IMPORT_UNDONE_REOPENED_MESSAGE =
  'Import undone. Your files and answers are back, so you can change anything and import again.'

/** Said when the undone import's files and answers are not on this screen to return to */
export const IMPORT_UNDONE_EMPTY_MESSAGE = 'Import undone. Upload the files again to import them.'

/** What an undo does to one importer on the page */
export type ImportUndoOutcome = 'reopen' | 'reset' | 'keep'

/**
 * Decides what undoing an import does to an importer
 *
 * The importer that saved the undone import gets its files and answers back, unlocked. Any other
 * finished importer is a record of an import that is no longer the last, so it is emptied for a
 * fresh start. One still being filled in has nothing to do with the undone import and is left alone
 *
 * @param committedRunId - The run the importer saved, null while it has saved none
 * @param isFinished - Whether the importer holds a finished import
 * @param undoneRunId - The run that was undone
 */
export function chooseImportUndoOutcome({
  committedRunId,
  isFinished,
  undoneRunId,
}: {
  committedRunId: string | null
  isFinished: boolean
  undoneRunId: string
}): ImportUndoOutcome {
  if (committedRunId === undoneRunId) return 'reopen'
  return isFinished ? 'reset' : 'keep'
}

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

  return `This deletes everything ${entry.file_name ?? 'this import'} added: ${formatList(parts)}.`
}

function countWord(count: number, singular: string, plural: string) {
  return count > 0 ? `${count.toLocaleString()}\u00a0${count === 1 ? singular : plural}` : null
}
