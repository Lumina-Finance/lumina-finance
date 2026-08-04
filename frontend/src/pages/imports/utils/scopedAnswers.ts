import type { ImportFileDraft } from '@/pages/imports/types'

/**
 * Answers the user gave for one set of source values, with what those values came from
 *
 * A source value is only as good as where it was read from, so the same text in a different file,
 * or in a different column of the same file, is a different question and starts unanswered
 */
export interface ScopedImportAnswers<T> {
  scope: string
  answers: Record<string, T>
}

/**
 * Builds what a set of answers applies to, from the columns they were read out of and the files
 * those columns belong to
 */
export function buildImportAnswerScope(columnHeaders: string[], files: ImportFileDraft[]): string {
  return `${columnHeaders.join('|')}:${files.map((file) => file.id).join(',')}`
}

// One object stands for every set of answers that no longer applies, so the payload and preview
// only rebuild when an answer actually changed rather than on every render
const NO_ANSWERS: Record<string, never> = Object.freeze({})

/**
 * Reads the answers back while they still apply, and nothing once they do not
 */
export function readScopedImportAnswers<T>(
  stored: ScopedImportAnswers<T>,
  scope: string,
): Record<string, T> {
  return stored.scope === scope ? stored.answers : NO_ANSWERS
}

/**
 * Replaces the answers for a scope, dropping whatever was answered under an earlier one
 */
export function writeScopedImportAnswers<T>(
  scope: string,
  answers: Record<string, T>,
): ScopedImportAnswers<T> {
  return { scope, answers }
}

/**
 * Starts an empty set of answers, before any column has been mapped
 */
export function emptyScopedImportAnswers<T>(): ScopedImportAnswers<T> {
  return { scope: '', answers: {} }
}

/**
 * Reads a row selection back while it still applies, and an empty one once it does not
 *
 * This covers a different file or column producing the sources. Unmapping a column and mapping it
 * back arrives at the scope it started from, so the caller clears the ticks on that itself
 */
export function readScopedSelection(stored: ScopedImportAnswers<true>, scope: string): Set<string> {
  return new Set(Object.keys(readScopedImportAnswers(stored, scope)))
}

/**
 * Writes a row selection back under the scope its ticks were made in
 */
export function writeScopedSelection(scope: string, selection: Set<string>): ScopedImportAnswers<true> {
  return { scope, answers: Object.fromEntries([...selection].map((id) => [id, true])) }
}
