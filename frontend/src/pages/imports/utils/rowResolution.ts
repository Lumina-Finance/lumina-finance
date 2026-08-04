import type { AccountsOverview } from '@/api/accounts'
import type { Currency } from '@/api/currency'
import {
  CREATE_ACCOUNT_VALUE,
  getRowAmountTooPreciseReason,
  getRowCurrencyMismatchReason,
  ROW_ACCOUNT_BLANK_REASON,
  ROW_AMOUNT_BLANK_REASON,
  ROW_AMOUNT_TOO_LARGE_REASON,
  ROW_AMOUNT_UNREADABLE_REASON,
  ROW_CATEGORY_BLANK_REASON,
  ROW_COUNTERPARTY_IS_OWN_ACCOUNT_REASON,
  ROW_COUNTERPARTY_NOT_A_TRANSFER_REASON,
  ROW_DATE_BLANK_REASON,
  ROW_DATE_UNREADABLE_REASON,
} from '@/pages/imports/constants'
import type { ColumnMap, CsvRow } from '@/pages/imports/types'
import { findCurrencyExponent } from '@/utils/moneyInput'
import { splitImportedValues } from './categoryMatching'
import { getMappedValue } from './columnMapping'
import { type ImportDateFormat, parseImportNumber, readImportDate, toImportMinorUnits } from './valueParsers'

/**
 * Everything one row resolves to, which is what the commit sends and what the preview renders
 *
 * The amount stays the cell's own text rather than a converted number, because the API parses it
 * with exact decimals and converting here would be a second opinion about the same digits
 */
export interface ResolvedImportRow {
  accountSource: string
  categorySource: string
  importedDate: string
  dt: string
  amount: string
  merchantName: string | null
  notes: string | null
  tagNames: string[]
  counterpartySource: string | null

  /** The currency the row will be stored in, empty where its account source has not resolved to one */
  currency: string

  /**
   * The currency the file states for this row, upper-cased, empty where the cell is blank or no
   * currency column is mapped
   *
   * Kept apart from `currency` because the two are different claims: one is where the row will be
   * stored, the other is what the file says the row is in, and the import refuses a row where they
   * disagree rather than converting between them
   */
  importedCurrency: string
}

/**
 * What reading a row's values needs beyond the row itself
 */
export interface ImportRowContext {
  columnMap: ColumnMap
  dateFormat: ImportDateFormat | null

  /** Settled once per build and read back per row, since it answers a question about a source */
  currencyByAccountSource: Record<string, string>
}

/**
 * What judging a resolved row needs, all of it settled once per build
 */
export interface ImportRowJudgement {
  currencies: Currency[]
  accountMappings: Record<string, string>
  recordsCounterpartyBySource: Record<string, boolean>
}

/**
 * Resolves one CSV row to the values the import will use
 *
 * The preview and the commit payload both read a row through here, so what is shown and what is sent
 * cannot disagree about one. Judging the row is kept separate, because only the commit judges: the
 * preview runs before every mapping question has been answered, and it is handed the verdicts the
 * commit reached rather than reaching its own
 *
 * @param row - The row's cells, keyed by heading
 * @param fileId - Stands in as the account source for a file with no account column, since every row
 * in such a file belongs to the one account the file itself is
 */
export function resolveImportRow(row: CsvRow, fileId: string, context: ImportRowContext): ResolvedImportRow {
  const { columnMap, dateFormat } = context

  const accountSource = columnMap.account_id ? getMappedValue(row, columnMap.account_id) : fileId
  const importedDate = getMappedValue(row, columnMap.dt)
  return {
    accountSource,
    categorySource: getMappedValue(row, columnMap.category_id),
    importedDate,
    dt: dateFormat ? readImportDate(importedDate, dateFormat) : '',
    amount: getMappedValue(row, columnMap.amount),
    merchantName: cleanOptional(getMappedValue(row, columnMap.merchant_id)),
    notes: cleanOptional(getMappedValue(row, columnMap.notes)),
    tagNames: splitImportedValues(getMappedValue(row, columnMap.tag_ids)),
    counterpartySource: columnMap.counterparty_account_id
      ? cleanOptional(getMappedValue(row, columnMap.counterparty_account_id))
      : null,
    currency: context.currencyByAccountSource[accountSource] ?? '',
    importedCurrency: getMappedValue(row, columnMap.currency).toUpperCase(),
  }
}

/**
 * Reports why a resolved row cannot be converted, or null when it can
 *
 * The first failing check is what the row is listed under, since a row missing both its date and
 * its amount is one row to go and correct either way
 */
export function getImportRowProblem(row: ResolvedImportRow, judgement: ImportRowJudgement) {
  if (!row.accountSource) return ROW_ACCOUNT_BLANK_REASON
  if (!row.categorySource) return ROW_CATEGORY_BLANK_REASON

  // A cell nobody filled in and a cell the chosen format cannot read send the user to different
  // jobs, and both parsers answer the same way for an empty string, so the raw cell is asked first
  if (!row.importedDate) return ROW_DATE_BLANK_REASON
  if (!row.dt) return ROW_DATE_UNREADABLE_REASON
  if (!row.amount) return ROW_AMOUNT_BLANK_REASON
  if (parseImportNumber(row.amount) === null) return ROW_AMOUNT_UNREADABLE_REASON

  // Asked before the amount is judged, because the decimal places an amount is held to are the
  // account currency's, and a row stating another currency is one whose amount means something else
  if (row.importedCurrency && row.currency && row.importedCurrency !== row.currency) {
    return getRowCurrencyMismatchReason(row.importedCurrency, row.currency)
  }

  const amountProblem = getImportRowAmountProblem(row.amount, row.currency, judgement.currencies)
  if (amountProblem) return amountProblem

  if (!row.counterpartySource) return null

  if (!judgement.recordsCounterpartyBySource[row.categorySource]) return ROW_COUNTERPARTY_NOT_A_TRANSFER_REASON
  if (isSameMappedAccount(judgement.accountMappings, row.accountSource, row.counterpartySource)) {
    return ROW_COUNTERPARTY_IS_OWN_ACCOUNT_REASON
  }
  return null
}

/**
 * Settles which currency each account source resolves to
 *
 * A row is stored in the currency of the account it is written to, which is what decides how many
 * decimal places its amount may carry. A source answered as money outside the tracked accounts has
 * no currency of its own and is left out, and no row is written to such a source anyway
 *
 * The code is upper-cased to match what the payload sends for a new account, so the exponent is
 * looked up under the same spelling the API will be given
 */
export function getCurrencyByAccountSource(
  accountMappings: Record<string, string>,
  accountById: Map<string, AccountsOverview>,
  accountCreateCurrencies: Record<string, string>,
) {
  const currencyBySource: Record<string, string> = {}

  for (const [source, choice] of Object.entries(accountMappings)) {
    const code = choice === CREATE_ACCOUNT_VALUE
      ? accountCreateCurrencies[source] ?? ''
      : accountById.get(choice)?.currency ?? ''
    if (code) currencyBySource[source] = code.trim().toUpperCase()
  }

  return currencyBySource
}

/**
 * Reports why an amount cannot be stored in its row's currency, or null when it can
 *
 * This is the same judgement the API makes when it converts the cell, made here so an over-precise
 * or oversized amount is named against its row before the commit rather than failing the request.
 * A row whose account source has not resolved to a currency is left alone, since there are no
 * decimal places to judge it against
 */
function getImportRowAmountProblem(amount: string, currency: string, currencies: Currency[]) {
  if (!currency) return null

  const exponent = findCurrencyExponent(currencies, currency)
  if (exponent === null) return null

  const minorUnits = toImportMinorUnits(amount, exponent)
  if (typeof minorUnits === 'bigint') return null
  if (minorUnits === 'tooPrecise') return getRowAmountTooPreciseReason(currency)

  // An unreadable cell was already refused above, so the only reading left is a magnitude the
  // storage cannot take
  return ROW_AMOUNT_TOO_LARGE_REASON
}

/**
 * Reports whether the two sides of a transfer row end up in the same account, either through one
 * source being used on both sides or through two sources mapped onto one existing account, which is
 * how a renamed account is carried across
 *
 * Two different sources both set to create an account produce two separate accounts, so they match
 * only when the source itself is the same name
 */
function isSameMappedAccount(
  accountMappings: Record<string, string>,
  accountSource: string,
  counterpartySource: string,
) {
  if (accountSource === counterpartySource) return true

  const accountChoice = accountMappings[accountSource]
  if (!accountChoice || accountChoice === CREATE_ACCOUNT_VALUE) return false
  return accountChoice === accountMappings[counterpartySource]
}

function cleanOptional(value: string) {
  const trimmed = value.trim()
  return trimmed || null
}
