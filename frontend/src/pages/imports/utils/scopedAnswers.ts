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

/**
 * Reads the answers back while they still apply, and nothing once they do not
 */
export function readScopedImportAnswers<T>(
  stored: ScopedImportAnswers<T>,
  scope: string,
): Record<string, T> {
  return stored.scope === scope ? stored.answers : {}
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
 * Keeps only the rows still in front of the user
 *
 * A selection is made against the sources on screen, so remapping a column away and back must not
 * bring rows back already ticked
 */
export function keepScopedSelection(selection: Set<string>, sourceIds: string[]): Set<string> {
  const current = new Set(sourceIds)
  const next = new Set([...selection].filter((id) => current.has(id)))

  return next.size === selection.size ? selection : next
}
