import type { CsvRow, ImportRowFilter } from '@/pages/imports/types'

/** Takes every row, for an import with no date range and for reading a whole file */
export const includeEveryImportRow: ImportRowFilter = () => true

/**
 * Narrows a row filter to the rows that will also be written, leaving out the rows the import refuses
 *
 * @param isRowIncluded - Which rows take part, such as the ones inside the chosen dates
 * @param refusedRowCells - The cells of every row the import refuses, as the payload builder lists them
 */
export function excludeRefusedRows(isRowIncluded: ImportRowFilter, refusedRowCells: CsvRow[]): ImportRowFilter {
  const refused = new Set(refusedRowCells)
  return (row) => isRowIncluded(row) && !refused.has(row)
}

/**
 * Returns a copy of a record without the given key, or the original record when the key was never
 * present, so state that did not actually change keeps the same identity and skips a re-render
 */
export function removeRecordKey<T>(record: Record<string, T>, key: string) {
  if (!(key in record)) return record
  const next = { ...record }
  delete next[key]
  return next
}

/**
 * Returns a copy of a set without the given value, or the original set when the value was never in
 * it, so state that did not actually change keeps the same identity and skips a re-render
 */
export function removeSetValue<T>(set: Set<T>, value: T) {
  if (!set.has(value)) return set
  const next = new Set(set)
  next.delete(value)
  return next
}

/**
 * Collects the distinct values from a list in the order they first appear, dropping empty strings so
 * blank cells in an imported file never become an option the user can pick
 */
export function unique(values: string[]) {
  return Array.from(new Set(values.filter(Boolean)))
}

/**
 * Identifies one parsed row within the staged files
 *
 * The payload builder and the preview both work out which rows to leave out, and they have to agree
 * exactly, so the identity is built here rather than written out at each of them
 */
export function getImportRowId(fileId: string, rowIndex: number) {
  return `${fileId}-${rowIndex}`
}

/**
 * Renders a file size for display, stepping up from bytes to kilobytes to megabytes in units of 1024
 * and keeping one decimal place above the byte range, rounded up so a file just over a limit never
 * reads as the limit itself
 */
export function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${roundUpToTenth(bytes / 1024)} KB`
  return `${roundUpToTenth(bytes / 1024 / 1024)} MB`
}

/** Rounds up to one decimal place and writes it with that place kept */
function roundUpToTenth(value: number) {
  return (Math.ceil(value * 10) / 10).toFixed(1)
}

/**
 * Joins the counts of a finished import into one summary line that wraps only between counts, so a
 * narrow overlay never leaves a number on one line and what it counts on the next
 */
export function joinImportSummaryParts(parts: string[]) {
  return parts.map((part) => part.replaceAll(' ', ' ')).join(' · ')
}

/**
 * Counts the sources answered create-new that the import sends, since the commit creates nothing
 * for a source it leaves out
 */
export function countCreatedImportSources(
  sources: string[],
  mappings: Record<string, string>,
  createValue: string,
  writtenSources: ReadonlySet<string>,
) {
  return sources.filter((source) => mappings[source] === createValue && writtenSources.has(source)).length
}

/**
 * Reduces a column heading to lower-case words separated by single spaces, for matching it against
 * the headings the import knows
 *
 * Full-width letters, digits and brackets read as their plain forms, and an accented Latin letter as
 * its plain letter, so `Débit` is the word `debit` rather than the two words `d` and `bit`. Only the
 * marks on Latin letters are dropped: a Japanese sound mark is part of its letter, and the text is
 * recomposed afterwards so a Korean syllable stays one character. Letters of every script are kept,
 * since a heading written in Japanese, Korean or Chinese is nothing but such letters
 *
 * A name written in camel case is split first, so `AccountNumber` reads as the two words
 * `Account Number` already does and the checks that work on words see both of them. Squeezing the
 * spaces back out afterwards gives the same key either spelling
 */
export function normalizeImportHeading(heading: string) {
  return heading
    .normalize('NFKD')
    .replace(/(\p{Script=Latin})\p{M}+/gu, '$1')
    .normalize('NFC')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
}
