import type { ImportFileDraft } from '@/pages/imports/types'

/**
 * Answers the user gave, filed under what each one was about
 *
 * A source value is only as good as where it was read from, so the same text in a different file,
 * or in a different column of the same file, is a different question and starts unanswered. The
 * answers are held one bucket per scope rather than one bucket for all of them, so answering a
 * value under one column leaves an answer given for the same value under another column alone
 */
export type ScopedImportAnswers<T> = Record<string, Record<string, T>>

/** Works out what a source value was read from, which is what its answer applies to */
export type ImportSourceScope = (sourceId: string) => string

/**
 * Builds what an answer applies to, from the column it was read out of and the files that column
 * belongs to
 */
export function buildImportAnswerScope(columnHeader: string, files: ImportFileDraft[]): string {
  return `${columnHeader}:${files.map((file) => file.id).join(',')}`
}

/**
 * Starts with nothing answered
 */
export function emptyScopedImportAnswers<T>(): ScopedImportAnswers<T> {
  return {}
}

/**
 * Reads back every answer still about the source it was given for
 *
 * An answer whose source now comes from somewhere else is left where it is rather than dropped, so
 * putting that column back is not the same as answering the question again
 */
export function readScopedImportAnswers<T>(
  stored: ScopedImportAnswers<T>,
  getSourceScope: ImportSourceScope,
): Record<string, T> {
  const answers: Record<string, T> = {}

  for (const [scope, scopedAnswers] of Object.entries(stored)) {
    for (const [sourceId, answer] of Object.entries(scopedAnswers)) {
      if (getSourceScope(sourceId) === scope) answers[sourceId] = answer
    }
  }

  return answers
}

/**
 * Files a whole set of answers under what each one is about
 *
 * The answers given are everything currently in front of the user, so one dropped from them is
 * dropped from its bucket, while a bucket for a column that is not mapped right now is untouched
 */
export function writeScopedImportAnswers<T>(
  stored: ScopedImportAnswers<T>,
  answers: Record<string, T>,
  getSourceScope: ImportSourceScope,
): ScopedImportAnswers<T> {
  const next: ScopedImportAnswers<T> = {}

  for (const [scope, scopedAnswers] of Object.entries(stored)) {
    for (const [sourceId, answer] of Object.entries(scopedAnswers)) {
      if (getSourceScope(sourceId) === scope) continue
      next[scope] = { ...next[scope], [sourceId]: answer }
    }
  }

  for (const [sourceId, answer] of Object.entries(answers)) {
    const scope = getSourceScope(sourceId)
    next[scope] = { ...next[scope], [sourceId]: answer }
  }

  return next
}

/**
 * Forgets every answer filed under one scope
 *
 * What this is for is the state a scope alone cannot tell apart: a column unmapped and mapped back
 * arrives at the string it started from, so a caller that wants those answers gone says so here
 */
export function clearScopedImportAnswers<T>(
  stored: ScopedImportAnswers<T>,
  scope: string,
): ScopedImportAnswers<T> {
  if (!(scope in stored)) return stored

  const next = { ...stored }
  delete next[scope]
  return next
}

/**
 * Reads back the rows still ticked against the sources they were ticked for
 */
export function readScopedSelection(
  stored: ScopedImportAnswers<true>,
  getSourceScope: ImportSourceScope,
): Set<string> {
  return new Set(Object.keys(readScopedImportAnswers(stored, getSourceScope)))
}

/**
 * Files a row selection under what each tick was made against
 */
export function writeScopedSelection(
  stored: ScopedImportAnswers<true>,
  selection: Set<string>,
  getSourceScope: ImportSourceScope,
): ScopedImportAnswers<true> {
  const ticked = Object.fromEntries([...selection].map((sourceId) => [sourceId, true as const]))
  return writeScopedImportAnswers(stored, ticked, getSourceScope)
}
