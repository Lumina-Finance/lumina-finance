import type { AccountsOverview } from '@/api/accounts'
import type { Category } from '@/api/categories'
import type { Currency } from '@/api/currency'
import type { Institution } from '@/api/institutions'
import { getOfxSkippedRowId, getOfxCategorySource, getOfxStatementsToImport } from '@/pages/imports/ofx/utils/payload'
import type { OfxFile } from '@/pages/imports/ofx/types'
import type { ImportAccountCreateDetails, PreviewTransactionRow } from '@/pages/imports/types'
import {
  buildPreviewTransactionRow,
  findUnnamedSourceCategory,
  getPreviewCounterpartyScope,
  resolvePreviewAccount,
  toImportMinorUnits,
} from '@/pages/imports/utils'
import { findCurrencyExponent } from '@/utils/moneyInput'

export interface OfxPreviewOptions {
  accountMappings: Record<string, string>
  accountCreateDetails: Record<string, ImportAccountCreateDetails>
  accountById: Map<string, AccountsOverview>
  institutionById: Map<string, Institution>
  categories: Category[] | undefined
  currencies: Currency[]

  /** Transactions the upload leaves out, which the preview leaves out too */
  skippedRowIds: ReadonlySet<string>
}

/**
 * Compiles the first transactions the commit will write, applying the account answers the way the
 * commit does
 *
 * A statement waiting on an account answer, or answered with an account in another currency, is left
 * out until it has a usable one, since its transactions are not written until then
 */
export function buildOfxPreviewRows(file: OfxFile, options: OfxPreviewOptions, limit: number): PreviewTransactionRow[] {
  const timestamp = new Date().toISOString()
  const previewRows: PreviewTransactionRow[] = []

  for (const statement of getOfxStatementsToImport(file)) {
    const account = resolvePreviewAccount(
      options.accountMappings[statement.id] ?? '',
      statement.name,
      options.accountCreateDetails[statement.id],
      options.accountById,
      options.institutionById,
    )
    const exponent = findCurrencyExponent(options.currencies, statement.currency)
    if (!account || account.currency.toUpperCase() !== statement.currency || exponent === null) continue

    for (const transaction of statement.transactions) {
      if (previewRows.length >= limit) return previewRows
      if (options.skippedRowIds.has(getOfxSkippedRowId(statement, transaction))) continue

      const amount = toImportMinorUnits(transaction.amount!, exponent)
      if (typeof amount !== 'bigint') continue

      const category = options.categories
        ? (findUnnamedSourceCategory(getOfxCategorySource(transaction), options.categories) ?? undefined)
        : undefined
      previewRows.push(
        buildPreviewTransactionRow({
          id: `ofx-preview-${getOfxSkippedRowId(statement, transaction)}`,
          account,
          category,
          dt: transaction.date!,
          amount,
          merchantName: transaction.payee,
          notes: transaction.memo,
          counterpartyAccount: null,
          counterpartyScope: getPreviewCounterpartyScope(category, null),
          tagNames: [],
          timestamp,
        }),
      )
    }
  }
  return previewRows
}
