import type { OfxFile, OfxFileRead, OfxStagedFile, OfxStatement } from '@/pages/imports/ofx/types'
import { ALREADY_ADDED_REASON, describeRefusedFile, isSameFile, MAX_IMPORT_ROWS } from '@/pages/imports/utils'

/** A file the reader has read, with what the staged list needs to tell it from the others */
export type OfxStagingCandidate = Omit<OfxStagedFile, 'file'> & { read: OfxFileRead }

export function countOfxTransactions(file: OfxFile) {
  return file.statements.reduce((total, statement) => total + statement.transactions.length, 0)
}

/**
 * Adds files one by one to the files already staged, in order, refusing each that cannot join them
 * and keeping the rest
 *
 * A refusal names its file, except where one file was chosen onto nothing, since that refusal is
 * about the file the user just chose and the file's name adds nothing
 *
 * @param staged - The files already staged
 * @param candidates - The files just read, in the order the user chose them
 * @returns The candidates that joined, and one message for each that did not
 */
export function stageOfxFiles(staged: OfxStagedFile[], candidates: OfxStagingCandidate[]) {
  const accepted: OfxStagedFile[] = []
  const refusals: string[] = []
  const isOnlyFile = staged.length === 0 && candidates.length === 1

  for (const { read, ...candidate } of candidates) {
    if (read.status === 'refused') {
      refusals.push(describeRefusedFile(candidate.name, read.reason, isOnlyFile))
      continue
    }

    const reason = getRefusalReason([...staged, ...accepted], candidate, countOfxTransactions(read.file))
    if (reason === null) accepted.push({ ...candidate, file: read.file })
    else refusals.push(describeRefusedFile(candidate.name, reason, isOnlyFile))
  }

  return { accepted, refusals }
}

function getRefusalReason(held: OfxStagedFile[], candidate: Omit<OfxStagedFile, 'file'>, transactionCount: number) {
  if (held.some((file) => isSameFile(file, candidate))) return ALREADY_ADDED_REASON

  const total = held.reduce((sum, file) => sum + countOfxTransactions(file.file), transactionCount)
  return total > MAX_IMPORT_ROWS
    ? `Together the files would have ${total.toLocaleString()} transactions, and the importer reads up to ${MAX_IMPORT_ROWS.toLocaleString()}.`
    : null
}

/**
 * Joins the statements of every staged file into the one file the import works on
 *
 * Statements for the same bank account, which the file gives the same id, and in the same currency
 * become one statement, so the account is matched once however many files hold it. Its transactions
 * follow in the order of the files and are numbered afresh, since each file numbered its own. Statements
 * with one id but two currencies stay apart, since one account cannot hold both
 */
export function combineOfxFiles(files: OfxFile[]): OfxFile {
  const merged = new Map<string, OfxStatement>()
  const leftOut = { investment: 0, loan: 0 }

  for (const file of files) {
    leftOut.investment += file.leftOut.investment
    leftOut.loan += file.leftOut.loan

    for (const statement of file.statements) {
      const key = `${statement.id}|${statement.currency}`
      const existing = merged.get(key)
      if (existing) {
        existing.transactions.push(...renumber(statement.transactions, existing.transactions.length))
      } else {
        merged.set(key, { ...separateByCurrency(statement, merged), transactions: renumber(statement.transactions, 0) })
      }
    }
  }

  return { statements: [...merged.values()], leftOut }
}

function renumber(transactions: OfxStatement['transactions'], after: number) {
  return transactions.map((transaction, position) => ({ ...transaction, index: after + position + 1 }))
}

/** Gives a statement whose id another currency already holds an id and name of its own */
function separateByCurrency(statement: OfxStatement, merged: Map<string, OfxStatement>) {
  const isIdTaken = [...merged.values()].some((held) => held.id === statement.id)
  return isIdTaken
    ? { ...statement, id: `${statement.id}:${statement.currency}`, name: `${statement.name} (${statement.currency})` }
    : statement
}
