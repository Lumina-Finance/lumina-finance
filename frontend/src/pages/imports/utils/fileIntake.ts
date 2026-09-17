export type ImportFileSelection =
  | { status: 'cancelled' }
  | { status: 'refused'; reason: string }
  | { status: 'accepted'; file: File }

export type ImportFileAcquisition =
  | ArrayLike<File>
  | Iterable<File>
  | ImportFileSelection

export type ImportFileIntakeResult<TResult> =
  | { status: 'cancelled' }
  | { status: 'unavailable'; reason: string }
  | { status: 'processing' }
  | { status: 'refused'; reason: string }
  | { status: 'accepted'; result: TResult }

/** The browser fields used to acquire a file from one dropped item */
export interface ImportDropItem {
  kind: string
  getAsFile: () => File | null
  webkitGetAsEntry?: () => { isDirectory: boolean } | null
}

export const MULTIPLE_FILES_REASON = 'Choose one CSV file at a time.'
export const NON_CSV_REASON = 'Choose a CSV file.'
export const NON_FILE_DROP_REASON = 'Drop a CSV file, not text or other page content.'
export const DIRECTORY_DROP_REASON = 'Folders cannot be uploaded. Choose one CSV file.'

/** Selects one acquired file when its name or declared type identifies CSV */
export function selectSingleCsvFile(files: ArrayLike<File> | Iterable<File>): ImportFileSelection {
  const acquiredFiles = Array.from(files)
  if (acquiredFiles.length === 0) return { status: 'cancelled' }
  if (acquiredFiles.length !== 1) return { status: 'refused', reason: MULTIPLE_FILES_REASON }

  const [file] = acquiredFiles
  const isCsv = file.name.toLowerCase().endsWith('.csv') || file.type.trim().toLowerCase() === 'text/csv'
  return isCsv ? { status: 'accepted', file } : { status: 'refused', reason: NON_CSV_REASON }
}

/** Acquires a file from one browser drop item */
export function selectDroppedImportFile(item: ImportDropItem): ImportFileSelection {
  if (item.kind !== 'file') return { status: 'refused', reason: NON_FILE_DROP_REASON }
  if (item.webkitGetAsEntry?.()?.isDirectory) {
    return { status: 'refused', reason: DIRECTORY_DROP_REASON }
  }

  const file = item.getAsFile()
  return file ? selectSingleCsvFile([file]) : { status: 'cancelled' }
}

/** Acquires one file from a browser drop while preserving item metadata */
export function selectDroppedImportFiles(
  items: ArrayLike<ImportDropItem>,
  files: ArrayLike<File> | Iterable<File>,
): ImportFileSelection {
  const droppedItems = Array.from(items)
  if (droppedItems.length === 1) return selectDroppedImportFile(droppedItems[0])
  if (droppedItems.some((item) => item.kind !== 'file')) {
    return { status: 'refused', reason: NON_FILE_DROP_REASON }
  }
  if (droppedItems.some((item) => item.webkitGetAsEntry?.()?.isDirectory)) {
    return { status: 'refused', reason: DIRECTORY_DROP_REASON }
  }
  if (droppedItems.length > 1) return { status: 'refused', reason: MULTIPLE_FILES_REASON }
  return selectSingleCsvFile(files)
}

/** Identifies an intake result supplied by a drop target */
function isImportFileSelection(value: ImportFileAcquisition): value is ImportFileSelection {
  return typeof value === 'object' && value !== null && 'status' in value
}

/** Checks intake availability and delegates an accepted file to the workflow reader */
export async function processImportFileIntake<TResult>({
  files,
  processing,
  unavailableReason,
  readFile,
}: {
  files: ImportFileAcquisition
  processing: boolean
  unavailableReason: string | null
  readFile: (file: File) => Promise<TResult>
}): Promise<ImportFileIntakeResult<TResult>> {
  if (unavailableReason) return { status: 'unavailable', reason: unavailableReason }
  if (processing) return { status: 'processing' }

  const selection = isImportFileSelection(files) ? files : selectSingleCsvFile(files)
  if (selection.status !== 'accepted') return selection

  return { status: 'accepted', result: await readFile(selection.file) }
}
