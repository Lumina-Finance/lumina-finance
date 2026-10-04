import type { AccountsOverview } from '@/api/accounts'
import type { Category } from '@/api/categories'
import type { Currency } from '@/api/currency'
import type { Institution } from '@/api/institutions'
import {
  CREATE_ACCOUNT_VALUE,
  CREATE_CATEGORY_VALUE,
  IMPORT_SAMPLE_PREVIEW_LIMIT,
  SELF_MERCHANT_NAME,
  UNKNOWN_MERCHANT_NAME,
} from '@/pages/imports/constants'
import { OUTSIDE_ACCOUNT_VALUE } from '@/utils/transfers'
import type {
  ColumnMap,
  ImportAmountDirection,
  ImportCategoryKind,
  ImportCategoryRename,
  ImportBuildResult,
  ImportFileDraft,
  ImportRowProblem,
  PreviewTransactionRow,
} from '@/pages/imports/types'
import { getImportAccountName } from './accountMapping'
import { getImportRowId } from './common'
import { getCategoryMatchKind } from './categoryMatching'
import { findCurrencyExponent } from '@/utils/moneyInput'
import { getCurrencyByAccountSource, type ImportRowContext, resolveImportRow } from './rowResolution'
import { getAmountArrangementClashError, getSupportedCurrencyCodes } from './workflowOptions'
import { DEFAULT_IMPORT_AMOUNT_FORMAT, type ImportAmountFormat } from './amountFormats'
import {
  buildPreviewCategory,
  buildPreviewTransactionRow,
  doesPreviewCategoryRecordCounterparty,
  getPreviewCounterpartyScope,
  resolvePreviewAccount,
} from './previewTransaction'
import {
  type ImportDateFormat,
  type ImportDateSeparator,
  isSupportedCurrency,
  toImportMinorUnits,
} from './valueParsers'

interface BuildImportPreviewRowsOptions {
  files: ImportFileDraft[]
  columnMap: ColumnMap
  dateFormat: ImportDateFormat | null
  dateSeparator?: ImportDateSeparator
  timeZone?: string
  amountFormat?: ImportAmountFormat | null
  directionAnswers: Record<string, ImportAmountDirection>
  missingRequiredColumnLabels: string[]
  currencies: Currency[]
  accountById: Map<string, AccountsOverview>
  accountCreateCurrencies: Record<string, string>
  accountCreateInstitutions: Record<string, string>
  categoryById: Map<string, Category>
  categoryCreateKinds: Record<string, ImportCategoryKind>

  /** New categories created under another name, because an existing category holds their own */
  categoryRenames?: Record<string, ImportCategoryRename>
  categoryTypesBySource: Record<string, string>
  institutionById: Map<string, Institution>
  resolvedAccountMappings: Record<string, string>
  resolvedCategoryMappings: Record<string, string>
  rowProblems: ImportRowProblem[]
}

/**
 * Groups consecutive preview rows that share the same date label, for rendering the preview list
 * under one heading per day
 */
export function groupPreviewRowsByDate(rows: PreviewTransactionRow[]) {
  const groups: Array<{ dateLabel: string; rows: PreviewTransactionRow[] }> = []

  for (const row of rows) {
    let group = groups[groups.length - 1]
    if (!group || group.dateLabel !== row.dateLabel) {
      group = { dateLabel: row.dateLabel, rows: [] }
      groups.push(group)
    }
    group.rows.push(row)
  }

  return groups
}

/**
 * Builds the first preview rows from mapped CSV files so the import review can show representative transactions
 */
export function buildImportPreviewRows({
  files,
  columnMap,
  dateFormat,
  dateSeparator = 'automatic',
  timeZone,
  amountFormat = DEFAULT_IMPORT_AMOUNT_FORMAT,
  directionAnswers,
  missingRequiredColumnLabels,
  currencies,
  accountById,
  accountCreateCurrencies,
  accountCreateInstitutions,
  categoryById,
  categoryCreateKinds,
  categoryRenames = {},
  categoryTypesBySource,
  institutionById,
  resolvedAccountMappings,
  resolvedCategoryMappings,
  rowProblems,
}: BuildImportPreviewRowsOptions): PreviewTransactionRow[] {
  if (missingRequiredColumnLabels.length > 0) return []

  // A map contradicting itself about the amount satisfies the required-column check, since any one
  // of the three fields answers it, and reading a row then picks the sides and ignores both the
  // Amount and the Direction column. That is a reading the commit refuses, so previewing it would
  // show rows the import will never write
  if (getAmountArrangementClashError(columnMap)) return []

  // A row that cannot be converted is listed with its reason instead, so previewing it as well
  // would show an amount of zero or a blank date beside the entry saying why it was refused
  const problemRowIds = new Set(rowProblems.map((problem) => problem.id))
  const rows: PreviewTransactionRow[] = []
  const fallbackCurrency = currencies.some((currency) => currency.id === 'CAD') ? 'CAD' : currencies[0]?.id ?? 'CAD'
  const supportedCurrencyCodes = getSupportedCurrencyCodes(currencies)
  const timestamp = new Date().toISOString()

  // Every row is read the same way the commit reads it, so the preview cannot show one thing and
  // send another
  const rowContext: ImportRowContext = {
    columnMap,
    dateFormat,
    dateSeparator,
    timeZone,
    amountFormat,
    directionAnswers,
    currencyByAccountSource: getCurrencyByAccountSource(resolvedAccountMappings, accountById, accountCreateCurrencies),
  }

  // Preview generation walks files in row order and stops early because the UI only renders a small sample
  for (const file of files) {
    for (let rowIndex = 0; rowIndex < file.rows.length; rowIndex += 1) {
      if (problemRowIds.has(getImportRowId(file.id, rowIndex))) continue

      const row = file.rows[rowIndex]
      const resolved = resolveImportRow(row, file.id, rowContext)
      const accountLabel = columnMap.account_id ? resolved.accountSource : getImportAccountName(file.name)
      const accountChoice = resolvedAccountMappings[resolved.accountSource] ?? ''
      const createDetails = {
        currency: accountCreateCurrencies[resolved.accountSource] ?? '',
        institutionId: accountCreateInstitutions[resolved.accountSource] ?? '',
      }
      const accountName = accountLabel || 'Unmapped account'
      const account = resolvePreviewAccount(accountChoice, accountName, createDetails, accountById, institutionById)

      // The currency the commit will store the row in, and the display fallback only where the
      // account step has not been answered yet. Rows are still built in that state and the preview
      // step shows the unanswered mappings instead of them, so the fallback is what keeps building
      // a row from failing rather than something the user reads
      const currency = getPreviewCurrency(
        resolved.currency,
        account?.currency,
        fallbackCurrency,
        supportedCurrencyCodes,
      )
      const exponent = findCurrencyExponent(currencies, currency)
      const minorUnits = exponent === null ? 'unreadable' : toImportMinorUnits(resolved.amount, exponent)

      // A row whose amount this currency cannot hold is one the commit will refuse, so it is left
      // out rather than previewed with a rounded number. It is usually already excluded as a
      // problem row, and reaches here either where an unanswered mapping question stopped the
      // payload build before it judged any row, or where the currency is missing from the loaded
      // table and there are no decimal places to convert against
      if (typeof minorUnits !== 'bigint') continue

      const category = getPreviewCategory(
        resolved.categorySource,
        resolvedCategoryMappings,
        categoryById,
        categoryCreateKinds,
        categoryRenames,
        categoryTypesBySource,
      )

      // A row states its counterparty only where the file has a column for it and the row's category
      // can hold one, and the answer is whatever that source was mapped to, which can be an account
      // or money leaving the app. A counterparty queued for creation shows under the source it came from
      const counterpartySource = doesPreviewCategoryRecordCounterparty(category) ? resolved.counterpartySource ?? '' : ''
      const counterpartyChoice = counterpartySource ? resolvedAccountMappings[counterpartySource] ?? '' : ''
      const counterpartyAccount = counterpartyChoice === OUTSIDE_ACCOUNT_VALUE
        ? null
        : resolvePreviewAccount(counterpartyChoice, counterpartySource, undefined, accountById, institutionById)

      // A source with no answer says nothing yet about where the money went. A file stating no
      // counterparty at all is a different case, and is read as the money leaving
      const isCounterpartyAnswered = !counterpartySource || Boolean(counterpartyChoice)

      rows.push(buildPreviewTransactionRow({
        id: getImportRowId(file.id, rowIndex),

        // The row shows in the currency settled above, which holds even before the account step is answered
        account: { ...(account ?? { id: accountChoice, name: accountName, institution: null }), currency },
        category,
        dt: resolved.dt,

        // Keep the exact minor units through presentation, just as the commit keeps the cell's digits
        amount: minorUnits,
        merchantName: resolved.merchantName ?? getStampedPreviewMerchantName(category),
        notes: resolved.notes,
        counterpartyAccount,
        counterpartyScope: isCounterpartyAnswered ? getPreviewCounterpartyScope(category, counterpartyAccount) : null,
        tagNames: resolved.tagNames,
        timestamp,
      }))

      if (rows.length >= IMPORT_SAMPLE_PREVIEW_LIMIT) return rows
    }
  }

  return rows
}

/**
 * Returns the merchant shown for a row whose file states no payee
 *
 * Every transaction carries a merchant, so the import fills one in rather than writing the row
 * without one, and the preview shows what the row will actually read as. A transfer, balance
 * adjustment included, has no payee of its own and gets the merchant the app puts on the transfers
 * it writes for itself
 */
function getStampedPreviewMerchantName(category: Category | undefined) {
  return category?.kind === 'transfer' ? SELF_MERCHANT_NAME : UNKNOWN_MERCHANT_NAME
}

/**
 * Picks the currency a previewed transaction is shown in, taking the first of the candidates the
 * loaded currency list actually holds and falling back to CAD when none of them is
 *
 * The row's settled currency leads, which is the one the commit will store it in. The rest are only
 * reached before the account step has been answered, or where an account is kept in a currency the
 * API did not serve, and they exist so the preview shows the row rather than dropping it
 *
 * The row's own currency column is deliberately not among them. A row is stored in its account's
 * currency, so previewing it in the imported one would show an amount scaled by decimal places the
 * import will not use, and a row whose two currencies disagree is refused before it reaches here
 */
export function getPreviewCurrency(
  rowCurrency: string,
  accountCurrency: string | undefined,
  fallbackCurrency: string,
  supportedCurrencyCodes: Set<string>,
) {
  for (const currency of [rowCurrency, accountCurrency, fallbackCurrency]) {
    const normalized = currency?.trim().toUpperCase()
    if (normalized && isSupportedCurrency(normalized, supportedCurrencyCodes)) return normalized
  }

  return 'CAD'
}

/**
 * Resolves the category a previewed transaction will use, building a placeholder record for a
 * category queued to be created and looking up an existing one otherwise
 *
 * The kind comes from the same reading the commit uses, so the two cannot disagree. Where that
 * reading has no answer yet, which is a source whose amounts move both ways or one with no readable
 * amounts, the row previews without a category rather than being shown a kind guessed from its own
 * sign that the commit would then refuse
 */
export function getPreviewCategory(
  importedCategory: string,
  categoryMappings: Record<string, string>,
  categoryById: Map<string, Category>,
  categoryCreateKinds: Record<string, ImportCategoryKind>,
  categoryRenames: Record<string, ImportCategoryRename>,
  categoryTypesBySource: Record<string, string>,
) {
  if (!importedCategory) return undefined

  const mapped = categoryMappings[importedCategory]
  if (mapped === CREATE_CATEGORY_VALUE) {
    const kind = getCategoryMatchKind(
      '',
      categoryCreateKinds[importedCategory],
      categoryTypesBySource[importedCategory],
      categoryById,
    )
    if (!kind) return undefined

    return buildPreviewCategory(importedCategory, categoryRenames[importedCategory]?.name ?? importedCategory, kind)
  }

  if (mapped) return categoryById.get(mapped)
  return undefined
}

/**
 * Works out the CSV import's summary figures, the same four every import's preview opens with
 *
 * Every row becomes one transaction, so a built import creates one per row it sends. Until it can
 * be built, the rows already refused are left out and the rest are counted, since answering the
 * questions still open changes which accounts and categories they land in, not whether they import.
 * A source answered create-new counts as one new account or category
 *
 * @param rowCount - Every data row in the staged files
 */
export function getCsvImportStats({
  rowCount,
  importBuild,
  accountSources,
  accountMappings,
  importedCategories,
  categoryMappings,
}: {
  rowCount: number
  importBuild: Pick<ImportBuildResult, 'payload' | 'rowProblems'>
  accountSources: Array<{ id: string }>
  accountMappings: Record<string, string>
  importedCategories: string[]
  categoryMappings: Record<string, string>
}) {
  return {
    rowCount,
    transactionEstimate: importBuild.payload?.rows.length ?? Math.max(rowCount - importBuild.rowProblems.length, 0),
    newAccountCount: accountSources.filter((source) => accountMappings[source.id] === CREATE_ACCOUNT_VALUE).length,
    newCategoryCount: importedCategories.filter((source) => categoryMappings[source] === CREATE_CATEGORY_VALUE).length,
  }
}
