import type { AccountsOverview } from '@/api/accounts'
import type { Category } from '@/api/categories'
import type { Currency } from '@/api/currency'
import type { Institution } from '@/api/institutions'
import {
  CREATE_ACCOUNT_VALUE,
  CREATE_CATEGORY_VALUE,
  DEFAULT_CATEGORY_ICON,
  SELF_MERCHANT_NAME,
  UNKNOWN_MERCHANT_NAME,
} from '@/pages/imports/constants'
import { BALANCE_ADJUSTMENT_CATEGORY_NAME, doesTransferRecordCounterpartyAccount, OUTSIDE_ACCOUNT_VALUE } from '@/utils/transfers'
import type {
  ColumnMap,
  ImportAmountDirection,
  ImportCategoryKind,
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
import {
  type ImportDateFormat,
  getPreviewDateLabel,
  isSupportedCurrency,
  toImportMinorUnits,
} from './valueParsers'

interface BuildImportPreviewRowsOptions {
  files: ImportFileDraft[]
  columnMap: ColumnMap
  dateFormat: ImportDateFormat | null
  directionAnswers: Record<string, ImportAmountDirection>
  missingRequiredColumnLabels: string[]
  currencies: Currency[]
  accountById: Map<string, AccountsOverview>
  accountCreateCurrencies: Record<string, string>
  accountCreateInstitutions: Record<string, string>
  categoryById: Map<string, Category>
  categoryCreateKinds: Record<string, ImportCategoryKind>
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
  directionAnswers,
  missingRequiredColumnLabels,
  currencies,
  accountById,
  accountCreateCurrencies,
  accountCreateInstitutions,
  categoryById,
  categoryCreateKinds,
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
      const account = accountChoice === CREATE_ACCOUNT_VALUE ? undefined : accountById.get(accountChoice)
      const createAccountCurrency = accountChoice === CREATE_ACCOUNT_VALUE
        ? accountCreateCurrencies[resolved.accountSource] ?? ''
        : ''
      const createAccountInstitution = accountChoice === CREATE_ACCOUNT_VALUE
        ? institutionById.get(accountCreateInstitutions[resolved.accountSource] ?? '')
        : undefined
      const dt = resolved.dt

      // The currency the commit will store the row in, and the display fallback only where the
      // account step has not been answered yet, which is a state the preview runs in and the
      // commit does not
      const currency = getPreviewCurrency(
        resolved.currency,
        account?.currency,
        createAccountCurrency,
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

      // Past the range a number holds exactly this loses digits, which is a display artifact on an
      // amount around ninety trillion in a two-decimal currency. The commit sends the cell's text
      const amount = Number(minorUnits)
      const importedTagValues = resolved.tagNames
      const category = getPreviewCategory(
        resolved.categorySource,
        resolvedCategoryMappings,
        categoryById,
        categoryCreateKinds,
        categoryTypesBySource,
      )
      const tagIds = importedTagValues.map((tag, tagIndex) => `${file.id}-${rowIndex}-tag-${tagIndex}-${tag}`)

      // A row states its counterparty only where the file has a column for it and the row's category
      // can hold one, and the answer is whatever that source was mapped to, which can be an account
      // or money leaving the app
      const recordsCounterparty = doesPreviewCategoryRecordCounterparty(category)
      const counterpartySource = recordsCounterparty ? resolved.counterpartySource ?? '' : ''
      const counterpartyChoice = counterpartySource ? resolvedAccountMappings[counterpartySource] ?? '' : ''
      const counterpartyAccount = counterpartyChoice === CREATE_ACCOUNT_VALUE || counterpartyChoice === OUTSIDE_ACCOUNT_VALUE
        ? undefined
        : accountById.get(counterpartyChoice)

      // An account queued for creation has no id or row of its own yet, so it stands in with the
      // same sentinel the row's own account uses and shows under the source it came from
      const counterpartyName = counterpartyChoice === CREATE_ACCOUNT_VALUE
        ? counterpartySource
        : counterpartyAccount?.name

      rows.push({
        id: getImportRowId(file.id, rowIndex),
        accountInstitution: account?.institution ?? createAccountInstitution ?? null,
        accountName: account?.name ?? (accountLabel || 'Unmapped account'),
        category,
        currency,
        dateLabel: getPreviewDateLabel(dt),
        counterpartyAccountName: counterpartyName,
        transaction: {
          id: `import-preview-${file.id}-${rowIndex}`,
          created_by_user_id: 'import-preview',
          account_id: account?.id ?? accountChoice,
          dt,
          merchant_id: `import-preview-merchant-${file.id}-${rowIndex}`,
          merchant_name: resolved.merchantName ?? getStampedPreviewMerchantName(category),
          category_id: category?.id ?? '',
          amount,
          account_amount: amount,
          base_currency_amount: amount,
          currency,
          fx_rate: null,
          notes: resolved.notes,

          counterparty_account_id: counterpartyAccount?.id ?? (counterpartyChoice === CREATE_ACCOUNT_VALUE ? CREATE_ACCOUNT_VALUE : null),
          counterparty_account_scope: getPreviewCounterpartyScope(
            recordsCounterparty,
            counterpartyChoice,
            !counterpartySource || Boolean(counterpartyChoice),
          ),
          created_at: timestamp,
          updated_at: timestamp,
          tag_ids: tagIds,
          tags: importedTagValues.map((tag, tagIndex) => ({
            id: tagIds[tagIndex],
            group_id: null,
            name: tag,
          })),
        },
      })

      if (rows.length >= 5) return rows
    }
  }

  return rows
}

/**
 * Reports whether a previewed row's category can record where the money went
 *
 * The backend matches Balance Adjustment by name alone, so this does too, and a row the API would
 * refuse a counterparty account for is previewed without one
 */
function doesPreviewCategoryRecordCounterparty(category: Category | undefined) {
  if (!category) return false
  return doesTransferRecordCounterpartyAccount(category.kind, category.name === BALANCE_ADJUSTMENT_CATEGORY_NAME)
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
 * Resolves what a previewed transfer will record about where the money went
 *
 * A transfer that states no counterparty records that the money left the app, which is what the
 * import writes for it, and a category that records neither leaves both fields empty
 *
 * @param recordsCounterparty - Whether this row's category records where the money went at all
 * @param counterpartyChoice - What the counterparty source is mapped to
 * @param isCounterpartyAnswered - Whether that source has an answer at all, which covers a source
 *   still waiting on one and a source whose account was deleted after it was chosen
 */
function getPreviewCounterpartyScope(
  recordsCounterparty: boolean,
  counterpartyChoice: string,
  isCounterpartyAnswered: boolean,
) {
  if (!recordsCounterparty) return null

  // A source with no answer says nothing yet about where the money went. A file stating no
  // counterparty at all is the separate case above, and is read as the money leaving
  if (!isCounterpartyAnswered) return null

  return counterpartyChoice && counterpartyChoice !== OUTSIDE_ACCOUNT_VALUE ? 'tracked' : 'outside'
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
  createAccountCurrency: string,
  fallbackCurrency: string,
  supportedCurrencyCodes: Set<string>,
) {
  for (const currency of [rowCurrency, accountCurrency, createAccountCurrency, fallbackCurrency]) {
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
 * reading has no answer yet, which is a source whose amounts run both ways or one with no readable
 * amounts, the row previews without a category rather than being shown a kind guessed from its own
 * sign that the commit would then refuse
 */
export function getPreviewCategory(
  importedCategory: string,
  categoryMappings: Record<string, string>,
  categoryById: Map<string, Category>,
  categoryCreateKinds: Record<string, ImportCategoryKind>,
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

    return {
      id: `import-preview-category-${importedCategory}`,
      group_id: null,
      owner_id: null,
      name: importedCategory,
      kind,
      icon: DEFAULT_CATEGORY_ICON,
      is_system: false,
      created_at: '',
    }
  }

  if (mapped) return categoryById.get(mapped)
  return undefined
}
