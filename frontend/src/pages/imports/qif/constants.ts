import type { ImportFileType } from '@/pages/imports/utils/fileIntake'

const MIB = 1024 * 1024

/** Largest QIF file the import reads, checked before the file is decoded */
export const MAX_QIF_FILE_BYTES = 25 * MIB

/** Said when a file is refused for what it is, so the next step is to choose a QIF file */
export const QIF_FILE_GUIDANCE = 'Choose a QIF file exported from your finance app.'

export const QIF_NOT_READABLE_REASON = `This isn't a QIF file. ${QIF_FILE_GUIDANCE}`
export const QIF_TOO_LARGE_REASON = `This file is larger than ${MAX_QIF_FILE_BYTES / MIB} MB, which is more than an export holds. ${QIF_FILE_GUIDANCE}`
export const QIF_NO_TRANSACTIONS_REASON = `This file has no bank, cash, credit card or other account transactions. ${QIF_FILE_GUIDANCE}`
export const QIF_ONLY_LEFT_OUT_REASON = "This file only holds investment transactions, which aren't imported."
export const QIF_TRUNCATED_REASON =
  'This file ends part way through a transaction. Export it again and choose the new file.'

export function getQifUnknownSectionReason(header: string) {
  return `This file has a section the importer doesn't recognize: ${header}. ${QIF_FILE_GUIDANCE}`
}

export const QIF_IMPORT_FILE_TYPE: ImportFileType = {
  matches: (file) => /\.qif$/i.test(file.name),
  processingStatus: 'Reading QIF files',
  dropTitle: 'Drop QIF files here',
  multipleFilesReason: null,
  wrongTypeReason: QIF_FILE_GUIDANCE,
  nonFileDropReason: 'Drop QIF files, not text or other page content.',
  directoryDropReason: `Folders cannot be uploaded. ${QIF_FILE_GUIDANCE}`,
}

/** What the progress overlay calls the upload stage */
export const QIF_UPLOAD_LABEL = 'Uploading the QIF files'

/** What a new account is proposed as for the kind of section its transactions are in */
export const QIF_BANK_ACCOUNT = { type: 'checking', label: 'Bank account' } as const
export const QIF_CASH_ACCOUNT = { type: 'cash', label: 'Cash account' } as const
export const QIF_CREDIT_CARD_ACCOUNT = { type: 'credit_card', label: 'Credit card' } as const
export const QIF_ASSET_ACCOUNT = { type: 'checking', label: 'Asset account' } as const
export const QIF_LIABILITY_ACCOUNT = { type: 'loan', label: 'Liability account' } as const

export const QIF_DATE_FORMAT_REQUIRED_ERROR = 'Choose how the dates in the files are written.'
export const QIF_AMOUNT_FORMAT_REQUIRED_ERROR = 'Choose how the amounts in the files are written.'

export const QIF_AMOUNTS_DIFFER_REASON =
  "The file gives two different amounts for this transaction, so the importer can't tell which is right."
export const QIF_SPLIT_UNREADABLE_REASON = 'A split amount is missing or is not a number.'

/** Says why a transaction whose split amounts do not add up to its total is left out */
export function getQifSplitMismatchReason(total: string) {
  return `The split amounts don't add up to the total of ${total}.`
}

/** Says what the files hold that the import leaves out */
export function getQifLeftOutNotice({ investment }: { investment: number }, fileCount: number) {
  if (investment === 0) return null

  const isOne = investment === 1
  return `${investment} investment ${isOne ? 'section' : 'sections'} in ${fileCount === 1 ? 'this file' : 'these files'} ${isOne ? "isn't" : "aren't"} imported: only bank, cash, credit card and other account transactions are supported.`
}

/** Says why a file is refused on an account's own import page, which takes one account from each file */
export function getQifMultipleStatementsReason(statementCount: number) {
  return `This file holds ${statementCount} accounts. Import it from the Imports page in Settings, where each one can go to an account of its own.`
}
