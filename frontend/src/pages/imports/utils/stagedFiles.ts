import type { ImportFileDraft } from '@/pages/imports/types'
import { formatBytes } from './common'
import { MAX_IMPORT_FILE_BYTES, MAX_IMPORT_ROWS } from './csv'
import { getImportIdentity } from './scopedAnswers'

/** A file the reader has read, with the browser file it was read from */
export type StagingCandidate = {
  draft: ImportFileDraft
  source: File
}

const COLUMNS_MISMATCH_REASON = 'Its columns don\'t match the first file.'
export const ALREADY_ADDED_REASON = 'It is already added.'
const FIRST_FILE_UNREADABLE_REASON = 'Fix the first file before adding more.'

/**
 * Whether two files share a layout, which is the headings and the separator the reader read them
 * with. The rows below the headings, and where the table starts, are free to differ
 */
function isSameLayout(layout: ImportFileDraft, draft: ImportFileDraft) {
  return layout.delimiter === draft.delimiter
    && layout.headers.length === draft.headers.length
    && layout.headers.every((header, index) => header === draft.headers[index])
}

/** Whether the browser says two files are one export picked twice */
export function isSameFile(first: Pick<File, 'name' | 'size' | 'lastModified'>, second: Pick<File, 'name' | 'size' | 'lastModified'>) {
  return first.name === second.name && first.size === second.size && first.lastModified === second.lastModified
}

/**
 * Finds why a file cannot join the files held, or null when it can
 *
 * The first file held sets the layout. A first file the reader refused with a reading the user can
 * change still stages, so the user can change it, but nothing can be checked against it until then
 */
function getRefusalReason(held: StagingCandidate[], { draft, source }: StagingCandidate): string | null {
  const first = held[0]?.draft
  if (first?.error) return FIRST_FILE_UNREADABLE_REASON

  if (draft.error) return !first && (draft.reading || draft.delimiter) ? null : draft.error
  if (held.some((file) => isSameFile(file.source, source))) return ALREADY_ADDED_REASON
  if (first && !isSameLayout(first, draft)) return COLUMNS_MISMATCH_REASON

  const totalBytes = held.reduce((sum, file) => sum + file.draft.size, draft.size)
  if (totalBytes > MAX_IMPORT_FILE_BYTES) {
    return `Together the files would be ${formatBytes(totalBytes)}, and the importer reads up to ${formatBytes(MAX_IMPORT_FILE_BYTES)}.`
  }

  const totalRows = held.reduce((sum, file) => sum + file.draft.rows.length, draft.rows.length)
  if (totalRows > MAX_IMPORT_ROWS) {
    return `Together the files would have ${totalRows.toLocaleString()} rows, and the importer reads up to ${MAX_IMPORT_ROWS.toLocaleString()}.`
  }

  return null
}

/**
 * Adds files one by one to the files already staged, in order, refusing each that cannot join them
 * and keeping the rest
 *
 * A refusal names its file, except where one file was chosen onto nothing, since that refusal is
 * about the file the user just chose and the file's name adds nothing
 *
 * @param staged - The files already staged, the first of which sets the layout
 * @param candidates - The files just read, in the order the user chose them
 * @returns The candidates that joined, and one message for each that did not
 */
export function stageImportFiles(staged: StagingCandidate[], candidates: StagingCandidate[]) {
  const accepted: StagingCandidate[] = []
  const refusals: string[] = []
  const isOnlyFile = staged.length === 0 && candidates.length === 1

  for (const candidate of candidates) {
    const reason = getRefusalReason([...staged, ...accepted], candidate)
    if (reason === null) accepted.push(candidate)
    else refusals.push(describeRefusedFile(candidate.draft.name, reason, isOnlyFile))
  }

  return { accepted, refusals }
}

/**
 * Words the refusal of one file, naming it unless it was the only file chosen, since then the
 * refusal is about the file the user just chose and its name adds nothing
 */
export function describeRefusedFile(name: string, reason: string, isOnlyFile: boolean) {
  return isOnlyFile ? reason : `"${name}" was not added. ${reason}`
}

/**
 * Names each staged file as the import names it everywhere, by its own name, with its position
 * among the files added, such as "statement.qfx (file 2)", when another file has the same name,
 * since many banks name every download alike
 *
 * @returns One label for each file, in the order the files were given
 */
export function labelStagedFiles(files: Array<{ name: string }>) {
  const counts = new Map<string, number>()
  for (const { name } of files) counts.set(name, (counts.get(name) ?? 0) + 1)
  return files.map(({ name }, index) => ((counts.get(name) ?? 0) > 1 ? `${name} (file ${index + 1})` : name))
}

/**
 * Takes one file out of the staged files, handing the import's identity on when the first file is
 * the one removed
 *
 * The answers and the account the rows are written to are held under the first file's identity, so
 * the file that becomes first takes it over, and removing any one file keeps every answer. Each
 * file keeps its own id, which is what a list draws it by
 */
export function removeStagedFile(files: ImportFileDraft[], fileId: string): ImportFileDraft[] {
  const remaining = files.filter((file) => file.id !== fileId)
  if (remaining.length === 0 || files[0]?.id !== fileId) return remaining
  return [{ ...remaining[0], identityId: getImportIdentity(files) }, ...remaining.slice(1)]
}
