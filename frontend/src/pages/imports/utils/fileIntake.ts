export type ImportFileSelection =
  | { status: 'cancelled' }
  | { status: 'refused'; reason: string }
  | { status: 'accepted'; files: File[] }

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

/** The kind of file an upload takes, with how each way of offering the wrong thing is refused */
export interface ImportFileType {
  matches: (file: File) => boolean

  /** Shown on the upload card and read out while the file is being read */
  processingStatus: string

  /** Why more than one file is refused, or null for an upload that takes several at once */
  multipleFilesReason: string | null
  wrongTypeReason: string
  nonFileDropReason: string
  directoryDropReason: string
}

export const MULTIPLE_FILES_REASON = 'Choose one CSV file at a time.'
export const NON_CSV_REASON = 'Choose a CSV file.'
export const NON_FILE_DROP_REASON = 'Drop a CSV file, not text or other page content.'
export const DIRECTORY_DROP_REASON = 'Folders cannot be uploaded. Choose one CSV file.'

const isCsvFile = (file: File) => file.name.toLowerCase().endsWith('.csv') || file.type.trim().toLowerCase() === 'text/csv'

/** A CSV file, told by its name or declared type */
export const CSV_IMPORT_FILE_TYPE: ImportFileType = {
  matches: isCsvFile,
  processingStatus: 'Processing CSV',
  multipleFilesReason: MULTIPLE_FILES_REASON,
  wrongTypeReason: NON_CSV_REASON,
  nonFileDropReason: NON_FILE_DROP_REASON,
  directoryDropReason: DIRECTORY_DROP_REASON,
}

/** CSV files that share one layout and make one import */
export const SEVERAL_CSV_IMPORT_FILE_TYPE: ImportFileType = {
  matches: isCsvFile,
  processingStatus: 'Processing CSV',
  multipleFilesReason: null,
  wrongTypeReason: 'Choose CSV files.',
  nonFileDropReason: 'Drop CSV files, not text or other page content.',
  directoryDropReason: 'Folders cannot be uploaded. Choose CSV files.',
}

/** What the upload card says while files are dragged over it, which depends on how many it takes */
export function getDropPrompt(fileType: ImportFileType) {
  return fileType.multipleFilesReason === null
    ? { title: 'Drop CSV files here', hint: 'Release to upload them.' }
    : { title: 'Drop CSV file here', hint: 'Release to upload one file.' }
}

/**
 * Selects the acquired files when every one is of the type the upload takes, and refuses the whole
 * set when one is not or when the upload takes only one
 */
export function selectImportFiles(
  files: ArrayLike<File> | Iterable<File>,
  fileType: ImportFileType = CSV_IMPORT_FILE_TYPE,
): ImportFileSelection {
  const acquiredFiles = Array.from(files)
  if (acquiredFiles.length === 0) return { status: 'cancelled' }
  if (acquiredFiles.length > 1 && fileType.multipleFilesReason !== null) {
    return { status: 'refused', reason: fileType.multipleFilesReason }
  }

  return acquiredFiles.every(fileType.matches)
    ? { status: 'accepted', files: acquiredFiles }
    : { status: 'refused', reason: fileType.wrongTypeReason }
}

/** Acquires a file from one browser drop item */
export function selectDroppedImportFile(item: ImportDropItem, fileType: ImportFileType = CSV_IMPORT_FILE_TYPE): ImportFileSelection {
  if (item.kind !== 'file') return { status: 'refused', reason: fileType.nonFileDropReason }
  if (item.webkitGetAsEntry?.()?.isDirectory) {
    return { status: 'refused', reason: fileType.directoryDropReason }
  }

  const file = item.getAsFile()
  return file ? selectImportFiles([file], fileType) : { status: 'cancelled' }
}

/** Acquires the files from a browser drop while preserving item metadata */
export function selectDroppedImportFiles(
  items: ArrayLike<ImportDropItem>,
  files: ArrayLike<File> | Iterable<File>,
  fileType: ImportFileType = CSV_IMPORT_FILE_TYPE,
): ImportFileSelection {
  const droppedItems = Array.from(items)
  if (droppedItems.length === 1) return selectDroppedImportFile(droppedItems[0], fileType)
  if (droppedItems.some((item) => item.kind !== 'file')) {
    return { status: 'refused', reason: fileType.nonFileDropReason }
  }
  if (droppedItems.some((item) => item.webkitGetAsEntry?.()?.isDirectory)) {
    return { status: 'refused', reason: fileType.directoryDropReason }
  }
  if (droppedItems.length > 1 && fileType.multipleFilesReason !== null) {
    return { status: 'refused', reason: fileType.multipleFilesReason }
  }
  if (droppedItems.length > 1) {
    return selectImportFiles(droppedItems.flatMap((item) => item.getAsFile() ?? []), fileType)
  }
  return selectImportFiles(files, fileType)
}

/** Identifies an intake result supplied by a drop target */
function isImportFileSelection(value: ImportFileAcquisition): value is ImportFileSelection {
  return typeof value === 'object' && value !== null && 'status' in value
}

/** Checks intake availability and delegates the accepted files to the workflow reader */
export async function processImportFileIntake<TResult>({
  files,
  processing,
  unavailableReason,
  readFiles,
  fileType = CSV_IMPORT_FILE_TYPE,
}: {
  files: ImportFileAcquisition
  processing: boolean
  unavailableReason: string | null
  readFiles: (files: File[]) => Promise<TResult>
  fileType?: ImportFileType
}): Promise<ImportFileIntakeResult<TResult>> {
  if (unavailableReason) return { status: 'unavailable', reason: unavailableReason }
  if (processing) return { status: 'processing' }

  const selection = isImportFileSelection(files) ? files : selectImportFiles(files, fileType)
  if (selection.status !== 'accepted') return selection

  return { status: 'accepted', result: await readFiles(selection.files) }
}
