import type { AccountsOverview } from '@/api/accounts'
import type { HeldBankTransactionItem, HeldBankTransactionsScope } from '@/api/transaction-imports'
import type { OfxFile } from '@/pages/imports/ofx/types'
import { getOfxSkippedRowId, getOfxStatementsToImport } from '@/pages/imports/ofx/utils/payload'
import { isGroupResource } from '@/pages/imports/utils/resourceScope'
import { isImportableAccount } from '@/utils/importableAccount'

/** What to ask the server about the files staged, and how to read its answer back onto the rows */
export interface OfxHeldCheck {
  /** Null when no row goes into an existing account, so there is nothing to ask */
  scope: HeldBankTransactionsScope | null

  /** The transactions to ask about, which carry the bank values and so are never part of the cache key */
  items: HeldBankTransactionItem[]

  /** The skipped-row id of each item, in the order of `items` */
  rowIds: string[]
}

/**
 * Lists the transactions of the staged statements that go into an existing account and carry a bank ID
 *
 * Rows bound for a new account are never sent, since a new account holds nothing yet. The list does not
 * depend on which rows the import leaves out for other reasons, so a repeat or an unreadable amount
 * never changes what is asked. The scope names the files, the statements' positions and their accounts
 * and holds no bank value, so the cached answer holds none either
 *
 * @param file - The statements of every staged file together
 * @param stagedFileIds - The ids of the staged files
 * @param accountMappings - The account each statement was answered with, by the statement's id
 * @param accountById - The user's accounts
 */
export function buildOfxHeldCheck(
  file: OfxFile,
  stagedFileIds: string[],
  accountMappings: Record<string, string>,
  accountById: Map<string, AccountsOverview>,
): OfxHeldCheck {
  const items: HeldBankTransactionItem[] = []
  const rowIds: string[] = []
  const statementAccounts: Array<[number, string]> = []

  getOfxStatementsToImport(file).forEach((statement, position) => {
    const account = accountById.get(accountMappings[statement.id] ?? '')

    // The same accounts the payload writes to, so a statement it refuses is never asked about
    if (!account || isGroupResource(account) || !isImportableAccount(account)) return

    statementAccounts.push([position, account.id])
    for (const transaction of statement.transactions) {
      if (transaction.bankTransactionId === null) continue

      items.push({ account_id: account.id, bank_account: transaction.bankAccountKey, bank_transaction: transaction.bankTransactionId })
      rowIds.push(getOfxSkippedRowId(statement, transaction))
    }
  })

  return {
    scope: items.length === 0 ? null : { fileIds: stagedFileIds, statements: statementAccounts },
    items,
    rowIds,
  }
}

/** The skipped-row ids of the transactions the server says their account already holds */
export function getOfxHeldRowIds(check: OfxHeldCheck, held: number[]) {
  return new Set(held.map((position) => check.rowIds[position]))
}
