import type { AccountsOverview } from '@/api/accounts'
import type { Category } from '@/api/categories'
import { FIREFLY_NO_CATEGORY_SOURCE } from '@/api/firefly-imports'
import type { Institution } from '@/api/institutions'
import { CREATE_ACCOUNT_VALUE, CREATE_CATEGORY_VALUE, DEFAULT_CATEGORY_ICON } from '@/pages/imports/constants'
import type { Currency } from '@/api/currency'
import type { CsvRow, ImportCategoryKind } from '@/pages/imports/types'
import { MAX_IMPORT_MINOR_UNITS, toImportMinorUnits } from '@/pages/imports/utils'
import { findReusedImportCategory } from '@/pages/imports/utils/categoryMatching'
import { findCurrencyExponent } from '@/utils/moneyInput'
import {
  FIREFLY_BALANCE_ROW_UNATTACHED_REASON,
  FIREFLY_DEPOSIT_DESTINATION_UNTRACKED_REASON,
  FIREFLY_GENERIC_SKIP_REASON,
  FIREFLY_TRANSFER_ENDPOINT_UNTRACKED_REASON,
  FIREFLY_TYPE_DEPOSIT,
  FIREFLY_TYPE_OPENING_BALANCE,
  FIREFLY_TYPE_RECONCILIATION,
  FIREFLY_TYPE_WITHDRAWAL,
  FIREFLY_WITHDRAWAL_SOURCE_UNTRACKED_REASON,
  getFireflyUnsupportedTypeReason,
  isFireflyJournalType,
} from '@/pages/imports/firefly/constants'
import type { FireflyAccountSource, FireflyAccountSources } from '@/pages/imports/firefly/types'
import { getFireflyRowAmounts } from './derivation'
import type { FireflyAccountCreateDetails } from './payload'

/**
 * Mapping lookups needed to resolve journal rows the same way the commit will
 */
export interface FireflyRowResolutionOptions {
  /** The accounts rows are written to, which the account mappings and create details are keyed by */
  accountSources: FireflyAccountSources
  accountById: Map<string, AccountsOverview>
  accountMappings: Record<string, string>
  accountCreateDetails: Record<string, FireflyAccountCreateDetails>
  institutionById: Map<string, Institution>
  categoryById: Map<string, Category>
  categoryMappings: Record<string, string>
  categoryCreateKinds: Record<string, ImportCategoryKind>
  transferCategory: Category | undefined
  balanceAdjustmentCategory: Category | undefined

  /** Currency metadata, read for the decimal places each account's currency holds */
  currencies: Currency[]
}

/**
 * Ledger account details one tracked journal endpoint resolves to after the
 * user's mapping choices are applied
 */
export interface FireflyResolvedAccount {
  id: string
  name: string
  currency: string
  institution: Institution | null
}

/**
 * One ledger transaction a journal row produces
 */
export interface FireflyResolvedLeg {
  account: FireflyResolvedAccount
  amount: number
  category: Category | undefined
  merchantName: string | null

  /** Account the money moved to or from, held only by the two legs of a transfer */
  counterpartyAccount: FireflyResolvedAccount | null
}

/**
 * Outcome of resolving one journal row: the ledger legs the import will create, the reason the
 * import will skip the row, or neither while an account the row writes to has no answer yet
 */
export type FireflyRowResolution =
  | { legs: FireflyResolvedLeg[]; skipReason: null }
  | { legs: null; skipReason: string }
  | { legs: null; skipReason: null }

/**
 * Internal signal that a row cannot be converted, mirroring the backend's
 * skip error so both sides walk the same decision order
 */
class FireflyRowSkipError extends Error {
  readonly reason: string

  constructor(reason: string) {
    super(reason)
    this.reason = reason
  }
}

/**
 * Internal signal that a row writes to an imported account the user has not answered yet
 */
class FireflyAccountUnansweredError extends Error {}

/**
 * Resolves one journal row into the ledger legs the import will create, or
 * the backend-worded reason the import will skip the row
 */
export function resolveFireflyRowLegs(row: CsvRow, options: FireflyRowResolutionOptions): FireflyRowResolution {
  try {
    return { legs: buildFireflyRowLegs(row, options), skipReason: null }
  } catch (error) {
    if (error instanceof FireflyRowSkipError) return { legs: null, skipReason: error.reason }

    // The import stays blocked until the account is answered, and the answer decides the outcome
    if (error instanceof FireflyAccountUnansweredError) return { legs: null, skipReason: null }

    // A row failing in a way no skip rule anticipated must not break the
    // preview, so it is predicted as skipped with the same generic reason
    // the backend reports when its own fallback catches the row
    return { legs: null, skipReason: FIREFLY_GENERIC_SKIP_REASON }
  }
}

/**
 * Returns the mapped category a successful resolution will commit, or undefined when the row's
 * resolver used Transfer or Balance Adjustment instead
 */
export function getFireflyCategoryUsedByResolution(
  row: CsvRow,
  legs: FireflyResolvedLeg[],
  options: FireflyRowResolutionOptions,
) {
  const mappedCategory = getFireflyMappedCategory(row, options)
  if (!mappedCategory || !legs.some((leg) => leg.category?.id === mappedCategory.id)) return undefined

  const source = row.category?.trim() || FIREFLY_NO_CATEGORY_SOURCE
  if (options.categoryMappings[source] !== CREATE_CATEGORY_VALUE) return mappedCategory

  const reused = findReusedImportCategory(source, options.categoryById.values())
  return reused?.kind === mappedCategory.kind ? reused : undefined
}

/**
 * Builds the ledger legs for one journal row, throwing a skip error in the
 * same branch order as the backend resolver so predicted reasons match
 */
function buildFireflyRowLegs(row: CsvRow, options: FireflyRowResolutionOptions): FireflyResolvedLeg[] {
  const journalType = row.type?.trim().toLowerCase() ?? ''

  // A type the importer does not know is refused before any account is resolved, since the
  // transfer rule below would otherwise write it as a transfer between two imported accounts
  if (!isFireflyJournalType(journalType)) {
    throw new FireflyRowSkipError(getFireflyUnsupportedTypeReason(row.type?.trim() ?? ''))
  }

  const sourceAccountSource = options.accountSources.find(row.source_name, row.source_type)
  const destinationAccountSource = options.accountSources.find(row.destination_name, row.destination_type)
  const source = resolveFireflyMappedAccount(sourceAccountSource, options)
  const destination = resolveFireflyMappedAccount(destinationAccountSource, options)

  // Firefly III pairs balance rows with a virtual balance account, so the
  // imported side is whichever endpoint is a real account and money flowing
  // into it is positive
  if (journalType === FIREFLY_TYPE_OPENING_BALANCE || journalType === FIREFLY_TYPE_RECONCILIATION) {
    const account = destination ?? source
    if (!account) throw new FireflyRowSkipError(FIREFLY_BALANCE_ROW_UNATTACHED_REASON)

    const amount = getFireflyAmountInAccountCurrency(row, account.currency, options.currencies)
    return [{
      account,
      amount: destination ? amount : -amount,
      category: options.balanceAdjustmentCategory,
      merchantName: null,
      counterpartyAccount: null,
    }]
  }

  // A journal between two imported accounts is a transfer in Lumina no matter
  // the Firefly III type, which covers loan payments recorded as withdrawals
  // into a liability account
  if (source && destination) {
    // Two accounts in the file can be mapped onto one account, which is how a
    // renamed account is carried across. The pair would then be two cancelling
    // rows in that account, a shape the API refuses when entered by hand.
    // Two different accounts queued for creation share the create sentinel as
    // their id and still become two separate accounts, so their sources decide it
    const isSameCreate = sourceAccountSource?.id === destinationAccountSource?.id
    if (source.id === destination.id && (source.id !== CREATE_ACCOUNT_VALUE || isSameCreate)) {
      throw new FireflyRowSkipError('Transfer source and destination resolve to the same account')
    }

    return [
      {
        account: source,
        amount: -getFireflyAmountInAccountCurrency(row, source.currency, options.currencies),
        category: options.transferCategory,
        merchantName: null,
        counterpartyAccount: destination,
      },
      {
        account: destination,
        amount: getFireflyAmountInAccountCurrency(row, destination.currency, options.currencies),
        category: options.transferCategory,
        merchantName: null,
        counterpartyAccount: source,
      },
    ]
  }

  if (journalType === FIREFLY_TYPE_WITHDRAWAL) {
    if (!source) throw new FireflyRowSkipError(FIREFLY_WITHDRAWAL_SOURCE_UNTRACKED_REASON)

    return [{
      account: source,
      amount: -getFireflyAmountInAccountCurrency(row, source.currency, options.currencies),
      category: getFireflyMappedCategory(row, options),
      merchantName: row.destination_name?.trim() || null,
      counterpartyAccount: null,
    }]
  }

  if (journalType === FIREFLY_TYPE_DEPOSIT) {
    if (!destination) throw new FireflyRowSkipError(FIREFLY_DEPOSIT_DESTINATION_UNTRACKED_REASON)

    return [{
      account: destination,
      amount: getFireflyAmountInAccountCurrency(row, destination.currency, options.currencies),
      category: getFireflyMappedCategory(row, options),
      merchantName: row.source_name?.trim() || null,
      counterpartyAccount: null,
    }]
  }

  throw new FireflyRowSkipError(FIREFLY_TRANSFER_ENDPOINT_UNTRACKED_REASON)
}

/**
 * Resolves a tracked journal endpoint to the ledger account the mapping
 * choices produce, or null when the endpoint is not an imported account.
 * Throws while the endpoint is an imported account with no answer yet
 */
function resolveFireflyMappedAccount(
  accountSource: FireflyAccountSource | null,
  options: FireflyRowResolutionOptions,
): FireflyResolvedAccount | null {
  if (!accountSource) return null

  const choice = options.accountMappings[accountSource.id]
  if (!choice) throw new FireflyAccountUnansweredError()
  if (choice === CREATE_ACCOUNT_VALUE) {
    const details = options.accountCreateDetails[accountSource.id]
    return {
      id: CREATE_ACCOUNT_VALUE,
      name: accountSource.name,
      currency: (details?.currency ?? '').trim().toUpperCase(),
      institution: options.institutionById.get(details?.institutionId ?? '') ?? null,
    }
  }

  const account = options.accountById.get(choice)
  if (!account) return null
  return { id: account.id, name: account.name, currency: account.currency, institution: account.institution }
}

/**
 * Gets the row's absolute amount in account-currency minor units, throwing
 * the backend-worded skip error when no amount exists in that currency, the
 * matching raw amount is unparseable, or its magnitude cannot be stored
 */
function getFireflyAmountInAccountCurrency(row: CsvRow, accountCurrency: string, currencies: Currency[]): number {
  // Firefly III writes the journal amount in the transaction currency and
  // carries a foreign amount when a second currency is involved, so the
  // account-side value is whichever of the two matches the account currency.
  // Both are read as the payload sends them
  const { main, foreign } = getFireflyRowAmounts(row)

  let rawAmount: string
  if (accountCurrency && main?.currencyCode === accountCurrency) {
    rawAmount = main.amount
  } else if (foreign && foreign.currencyCode === accountCurrency) {
    rawAmount = foreign.amount
  } else {
    throw new FireflyRowSkipError(`Neither the amount nor the foreign amount is in the account's currency (${accountCurrency})`)
  }

  // Every account's currency is one the API served, so a missing exponent is unreachable. An
  // unanticipated failure is reported with the generic reason rather than a skip rule of its own
  const exponent = findCurrencyExponent(currencies, accountCurrency)
  if (exponent === null) throw new Error(`No currency metadata for ${accountCurrency}`)

  // Explain excess precision separately while malformed text and parser-range overflow retain the raw value
  const minorUnits = toImportMinorUnits(rawAmount, exponent)
  if (minorUnits === 'tooPrecise') {
    throw new FireflyRowSkipError(
      `The amount has more decimal places than ${accountCurrency} has. A period is read as a decimal point, never as a separator between thousands.`,
    )
  }
  if (minorUnits === 'unreadable' || minorUnits === 'tooLarge') {
    throw new FireflyRowSkipError(`Invalid amount "${rawAmount}"`)
  }

  // The import writes the magnitude rather than the parsed value, and the signed range holds one
  // more value below zero than above it, so the smallest amount the parser accepts negates into
  // one the column cannot take. Such a row is left out, since its unsigned amount would be past
  // what the endpoint stores
  const absoluteMinorUnits = minorUnits < 0n ? -minorUnits : minorUnits
  if (absoluteMinorUnits > MAX_IMPORT_MINOR_UNITS) throw new FireflyRowSkipError(`Amount is too large: "${rawAmount}"`)

  return Number(absoluteMinorUnits)
}

/**
 * Gets the category the user's mapping choices assign to a categorized row
 */
function getFireflyMappedCategory(
  row: CsvRow,
  options: FireflyRowResolutionOptions,
): Category | undefined {
  const source = row.category?.trim() || FIREFLY_NO_CATEGORY_SOURCE
  const choice = options.categoryMappings[source]

  if (choice === CREATE_CATEGORY_VALUE) {
    return {
      id: `firefly-preview-category-${source}`,
      group_id: null,
      owner_id: null,
      name: source,
      kind: options.categoryCreateKinds[source] ?? 'expense',
      icon: DEFAULT_CATEGORY_ICON,
      is_system: false,
      created_at: '',
    }
  }

  return choice ? options.categoryById.get(choice) : undefined
}
