import type { AccountsOverview } from '@/api/accounts'
import type { Category } from '@/api/categories'
import { FIREFLY_NO_CATEGORY_SOURCE, isFireflyTrackedAccountType } from '@/api/dataImports'
import type { Institution } from '@/api/institutions'
import { CREATE_ACCOUNT_VALUE, CREATE_CATEGORY_VALUE, DEFAULT_CATEGORY_ICON } from '../../constants'
import type { CsvRow, ImportCategoryKind } from '../../types'
import { parseImportNumber, toMinorUnits } from '../../utils'
import {
  FIREFLY_GENERIC_SKIP_REASON,
  FIREFLY_TYPE_DEPOSIT,
  FIREFLY_TYPE_OPENING_BALANCE,
  FIREFLY_TYPE_RECONCILIATION,
  FIREFLY_TYPE_TRANSFER,
  FIREFLY_TYPE_WITHDRAWAL,
  FIREFLY_UNCATEGORIZED_CATEGORY_NAME,
} from '../constants'
import type { FireflyAccountCreateDetails } from './payload'

/**
 * Mapping lookups needed to resolve journal rows the same way the commit will
 */
export interface FireflyRowResolutionOptions {
  accountById: Map<string, AccountsOverview>
  accountMappings: Record<string, string>
  accountCreateDetails: Record<string, FireflyAccountCreateDetails>
  institutionById: Map<string, Institution>
  categoryById: Map<string, Category>
  categoryMappings: Record<string, string>
  categoryCreateKinds: Record<string, ImportCategoryKind>
  transferCategory: Category | undefined
  balanceAdjustmentCategory: Category | undefined
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
}

/**
 * Outcome of resolving one journal row, either the ledger legs the import
 * will create or the reason the import will skip the row
 */
export type FireflyRowResolution =
  | { legs: FireflyResolvedLeg[]; skipReason: null }
  | { legs: null; skipReason: string }

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
 * Resolves one journal row into the ledger legs the import will create, or
 * the backend-worded reason the import will skip the row
 */
export function resolveFireflyRowLegs(row: CsvRow, options: FireflyRowResolutionOptions): FireflyRowResolution {
  try {
    return { legs: buildFireflyRowLegs(row, options), skipReason: null }
  } catch (error) {
    if (error instanceof FireflyRowSkipError) return { legs: null, skipReason: error.reason }

    // A row failing in a way no skip rule anticipated must not break the
    // preview, so it is predicted as skipped with the same generic reason
    // the backend reports when its own fallback catches the row
    return { legs: null, skipReason: FIREFLY_GENERIC_SKIP_REASON }
  }
}

/**
 * Builds the ledger legs for one journal row, throwing a skip error in the
 * same branch order as the backend resolver so predicted reasons match
 */
function buildFireflyRowLegs(row: CsvRow, options: FireflyRowResolutionOptions): FireflyResolvedLeg[] {
  const journalType = row.type?.trim().toLowerCase() ?? ''
  const source = resolveFireflyMappedAccount(row.source_name, row.source_type, options)
  const destination = resolveFireflyMappedAccount(row.destination_name, row.destination_type, options)

  // Firefly III pairs balance rows with a virtual balance account, so the
  // imported side is whichever endpoint is a real account and money flowing
  // into it is positive
  if (journalType === FIREFLY_TYPE_OPENING_BALANCE || journalType === FIREFLY_TYPE_RECONCILIATION) {
    const account = destination ?? source
    if (!account) throw new FireflyRowSkipError('Opening balance or reconciliation row is not attached to an imported account')

    const amount = getFireflyAmountInAccountCurrency(row, account.currency)
    return [{
      account,
      amount: destination ? amount : -amount,
      category: options.balanceAdjustmentCategory,
      merchantName: null,
    }]
  }

  // A journal between two imported accounts is a transfer in Lumina no matter
  // the Firefly III type, which covers loan payments recorded as withdrawals
  // into a liability account
  if (source && destination) {
    return [
      {
        account: source,
        amount: -getFireflyAmountInAccountCurrency(row, source.currency),
        category: options.transferCategory,
        merchantName: null,
      },
      {
        account: destination,
        amount: getFireflyAmountInAccountCurrency(row, destination.currency),
        category: options.transferCategory,
        merchantName: null,
      },
    ]
  }

  if (journalType === FIREFLY_TYPE_WITHDRAWAL) {
    if (!source) throw new FireflyRowSkipError('Withdrawal source is not an imported account')

    return [{
      account: source,
      amount: -getFireflyAmountInAccountCurrency(row, source.currency),
      category: getFireflyMappedCategory(row, options),
      merchantName: row.destination_name?.trim() || null,
    }]
  }

  if (journalType === FIREFLY_TYPE_DEPOSIT) {
    if (!destination) throw new FireflyRowSkipError('Deposit destination is not an imported account')

    return [{
      account: destination,
      amount: getFireflyAmountInAccountCurrency(row, destination.currency),
      category: getFireflyMappedCategory(row, options),
      merchantName: row.source_name?.trim() || null,
    }]
  }

  if (journalType === FIREFLY_TYPE_TRANSFER) {
    throw new FireflyRowSkipError('Transfer endpoint is not an imported account')
  }

  throw new FireflyRowSkipError(
    `Journal type "${row.type?.trim() ?? ''}" is not supported, the importer handles`
    + ' withdrawals, deposits, transfers, opening balances, and reconciliations',
  )
}

/**
 * Resolves a tracked journal endpoint to the ledger account the mapping
 * choices produce, or null when the endpoint is not an imported account
 */
function resolveFireflyMappedAccount(
  name: string | undefined,
  accountType: string | undefined,
  options: FireflyRowResolutionOptions,
): FireflyResolvedAccount | null {
  const trimmedName = name?.trim() ?? ''
  if (!trimmedName || !isFireflyTrackedAccountType(accountType)) return null

  const choice = options.accountMappings[trimmedName]
  if (choice === CREATE_ACCOUNT_VALUE) {
    const details = options.accountCreateDetails[trimmedName]
    return {
      id: CREATE_ACCOUNT_VALUE,
      name: trimmedName,
      currency: (details?.currency ?? '').trim().toUpperCase(),
      institution: options.institutionById.get(details?.institutionId ?? '') ?? null,
    }
  }

  const account = choice ? options.accountById.get(choice) : undefined
  if (!account) return null
  return { id: account.id, name: account.name, currency: account.currency, institution: account.institution }
}

/**
 * Gets the row's absolute amount in account-currency minor units, throwing
 * the backend-worded skip error when no amount exists in that currency or
 * the matching raw amount is unparseable
 */
function getFireflyAmountInAccountCurrency(row: CsvRow, accountCurrency: string): number {
  // Firefly III writes the journal amount in the transaction currency and
  // carries a foreign amount when a second currency is involved, so the
  // account-side value is whichever of the two matches the account currency
  const rowCurrency = row.currency_code?.trim().toUpperCase() ?? ''
  const foreignCurrency = row.foreign_currency_code?.trim().toUpperCase() ?? ''
  const foreignAmount = row.foreign_amount?.trim() ?? ''

  let rawAmount: string
  if (accountCurrency && rowCurrency === accountCurrency) {
    rawAmount = row.amount?.trim() ?? ''
  } else if (foreignCurrency && foreignAmount && foreignCurrency === accountCurrency) {
    rawAmount = foreignAmount
  } else {
    throw new FireflyRowSkipError(`Neither the amount nor the foreign amount is in the account's currency (${accountCurrency})`)
  }

  const parsed = parseImportNumber(rawAmount)
  if (parsed === null) throw new FireflyRowSkipError(`Invalid amount "${rawAmount}"`)
  return Math.abs(toMinorUnits(parsed, accountCurrency))
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
      name: source === FIREFLY_NO_CATEGORY_SOURCE ? FIREFLY_UNCATEGORIZED_CATEGORY_NAME : source,
      kind: options.categoryCreateKinds[source] ?? 'expense',
      icon: DEFAULT_CATEGORY_ICON,
      is_system: false,
      created_at: '',
    }
  }

  return choice ? options.categoryById.get(choice) : undefined
}
