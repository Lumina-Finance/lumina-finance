import type { AccountsOverview } from '@/api/accounts'
import type { Category } from '@/api/categories'
import type { Currency } from '@/api/currency'
import type { JournalImportPayload, JournalImportRow } from '@/api/provider-imports'
import type { TransactionImportCategoryMapping } from '@/api/transaction-imports'
import {
  ACTUAL_ACCOUNT_NAME_MAX_LENGTH,
  ACTUAL_TRANSACTION_DECIMALS,
  getActualAccountNameTooLongError,
  getActualAmountPrecisionReason,
  getActualBuiltInTransferError,
  getActualCategoryCreateClashError,
  getActualFileCurrencyError,
  getActualMixedCurrencyError,
  getActualSharedAccountError,
  getActualTransferCategoryError,
} from '@/pages/imports/actual/constants'
import type { ActualCategorySource, ActualJournal, ActualJournalEntry, ActualSkippedRow } from '@/pages/imports/actual/types'
import { isImportAccountType } from '@/pages/imports/accountTypeGuard'
import {
  CREATE_ACCOUNT_VALUE,
  CREATE_CATEGORY_VALUE,
  DEFAULT_CATEGORY_ICON,
  MAX_IMPORT_MAPPINGS,
  getCategoryDirectionClashError,
  getImportAccountCurrencyRequiredError,
  getImportAccountMappingError,
  getImportAccountTypeRequiredError,
  getImportAccountTypeUnsupportedError,
  getImportCategoryMappingError,
  getImportCategoryTypeRequiredError,
  getImportNoRowsError,
  getImportReadOnlyAccountMappingError,
  getTooManyMappingsError,
} from '@/pages/imports/constants'
import type { ImportCategoryKind } from '@/pages/imports/types'
import { isImportableAccount } from '@/pages/imports/utils/accountScope'
import { findReusedImportCategory, getCategoryNameKey } from '@/pages/imports/utils/categoryMatching'
import { findCurrencyExponent } from '@/utils/moneyInput'
import { formatScaledAmount } from './amounts'
import { canCarryActualTransfer, canFileActualTransferSource } from './categories'
import { formatHundredths } from './normalise'

/** Create-new answers for one Actual account after the proposals are applied */
export interface ActualAccountCreateDetails {
  accountType: string
  currency: string
  institutionId: string
}

export interface ActualImportAnswers {
  accountMappings: Record<string, string>
  accountCreateDetails: Record<string, ActualAccountCreateDetails>
  accountById: Map<string, AccountsOverview>
  categoryMappings: Record<string, string>
  categoryCreateKinds: Record<string, ImportCategoryKind>
  categoryById: Map<string, Category>
  currencies: Currency[]

  /** The currency the file records for the budget, which every account must then be in */
  fileCurrency: string | null

  /** Category sources the selected budgets track, which the budgets request declares */
  budgetCategorySources: ReadonlySet<string>
}

export interface ActualImportBuild {
  errors: string[]
  payload: JournalImportPayload | null

  /** The one currency every account is in, once the answers settle one */
  currency: string | null

  /** Rows left out because their amount doesn't fit the currency they are written in */
  skippedRows: ActualSkippedRow[]

  /** Account sources the upload writes to or creates, and category sources it files rows under */
  writtenSources: { accounts: ReadonlySet<string>; categories: ReadonlySet<string> }

  /** Accounts the import creates for accounts Actual has closed, archived once written */
  archiveAccountSources: string[]

  /** Mappings for the category sources the selected budgets track, some of which no row uses */
  budgetCategoryMappings: TransactionImportCategoryMapping[]
}

/**
 * Compiles a normalised Actual budget and the user's answers into the upload, or the errors that
 * stop it
 *
 * Every Actual account is sent, so one without rows still comes across when the user creates it,
 * and one Actual has closed is archived when the import creates it. Refusals the commit would give
 * for the whole import are caught here instead, naming what to answer differently
 */
export function buildActualImportPayload(journal: ActualJournal, answers: ActualImportAnswers): ActualImportBuild {
  const errors: string[] = []
  const addError = (message: string) => {
    if (!errors.includes(message)) errors.push(message)
  }

  if (journal.accounts.length > MAX_IMPORT_MAPPINGS) addError(getTooManyMappingsError('account', journal.accounts.length))
  if (journal.categories.length > MAX_IMPORT_MAPPINGS) addError(getTooManyMappingsError('category', journal.categories.length))

  const { accounts, accountCurrencies, archiveAccountSources } = buildAccountMappings(journal, answers, addError)
  const currencySet = [...new Set(accountCurrencies.values())].sort()
  if (currencySet.length > 1) addError(getActualMixedCurrencyError(currencySet))
  const currency = currencySet.length === 1 ? currencySet[0] : null

  // Amounts are read in the file's own currency, so an account in any other would take them at the
  // wrong value
  if (answers.fileCurrency) {
    const mismatched = journal.accounts.filter((source) => {
      const accountCurrency = accountCurrencies.get(source.id)
      return accountCurrency && accountCurrency !== answers.fileCurrency
    })
    if (mismatched.length > 0) addError(getActualFileCurrencyError(answers.fileCurrency, mismatched.map((source) => source.label)))
  }

  const { rows, skippedRows, writtenCategorySources } = buildRows(journal, accountCurrencies, answers.currencies)
  // A budget can track a category no row uses, which still needs an answer the commit can take
  const mappedCategories = journal.categories.filter((source) => (
    writtenCategorySources.has(source.id) || answers.budgetCategorySources.has(source.id)
  ))
  const mappings = buildCategoryMappings(mappedCategories, answers, addError)
  const categories = mappings.filter((mapping) => writtenCategorySources.has(mapping.source))
  const budgetCategoryMappings = mappings.filter((mapping) => answers.budgetCategorySources.has(mapping.source))

  if (rows.length === 0) addError(getImportNoRowsError('export'))

  const writtenSources = {
    accounts: new Set(accounts.map((mapping) => mapping.source)),
    categories: writtenCategorySources,
  }
  const payload = errors.length === 0 ? { accounts, categories, rows } : null
  return { errors, payload, currency, skippedRows, writtenSources, archiveAccountSources, budgetCategoryMappings }
}

function buildAccountMappings(
  journal: ActualJournal,
  { accountMappings, accountCreateDetails, accountById }: ActualImportAnswers,
  addError: (message: string) => void,
) {
  const accounts: JournalImportPayload['accounts'] = []
  const accountCurrencies = new Map<string, string>()
  const archiveAccountSources: string[] = []
  const labelsByLinkedAccount = new Map<string, string[]>()

  for (const source of journal.accounts) {
    const choice = accountMappings[source.id]
    if (!choice) {
      addError(getImportAccountMappingError(source.label))
      continue
    }

    if (choice !== CREATE_ACCOUNT_VALUE) {
      // An existing account without rows from the file takes nothing, so its answer is kept but not sent
      if (source.rowCount === 0) continue
      const account = accountById.get(choice)
      if (account && !isImportableAccount(account)) {
        addError(getImportReadOnlyAccountMappingError(source.label, account))
        continue
      }
      labelsByLinkedAccount.set(choice, [...(labelsByLinkedAccount.get(choice) ?? []), source.label])
      if (account) accountCurrencies.set(source.id, account.currency.toUpperCase())
      accounts.push({ source: source.id, account_id: choice })
      continue
    }

    if ([...source.name].length > ACTUAL_ACCOUNT_NAME_MAX_LENGTH) {
      addError(getActualAccountNameTooLongError(source.label))
      continue
    }

    const details = accountCreateDetails[source.id]
    if (!details?.accountType) addError(getImportAccountTypeRequiredError(source.label))
    if (!details?.currency) addError(getImportAccountCurrencyRequiredError(source.label))
    if (!details?.accountType || !details.currency) continue
    if (!isImportAccountType(details.accountType)) {
      addError(getImportAccountTypeUnsupportedError(source.label))
      continue
    }

    const currency = details.currency.toUpperCase()
    accountCurrencies.set(source.id, currency)
    if (source.closed) archiveAccountSources.push(source.id)
    accounts.push({
      source: source.id,
      create: {
        name: source.name,
        account_type: details.accountType,
        currency,
        institution_id: details.institutionId || null,
      },
    })
  }

  // Two Actual accounts on one Lumina account would turn each transfer between them into two
  // cancelling rows in that account, which the commit refuses
  for (const [accountId, labels] of labelsByLinkedAccount) {
    if (labels.length > 1) addError(getActualSharedAccountError(labels, accountById.get(accountId)?.name ?? 'one account'))
  }

  return { accounts, accountCurrencies, archiveAccountSources }
}

function buildCategoryMappings(
  sources: ActualCategorySource[],
  { categoryMappings, categoryCreateKinds, categoryById }: ActualImportAnswers,
  addError: (message: string) => void,
) {
  const categories: JournalImportPayload['categories'] = []
  const createdByKey = new Map<string, { label: string; kind: ImportCategoryKind }>()

  for (const source of sources) {
    const choice = categoryMappings[source.id]
    if (!choice) {
      addError(getImportCategoryMappingError(source.label))
      continue
    }

    if (choice !== CREATE_CATEGORY_VALUE) {
      const category = categoryById.get(choice)
      if (source.role === 'transfer' && category && !canCarryActualTransfer(category)) {
        addError(getActualTransferCategoryError(source.label))
        continue
      }
      if (source.role === 'transfer' && category && !canFileActualTransferSource(source, category)) {
        addError(getActualBuiltInTransferError(source.label))
        continue
      }
      categories.push({ source: source.id, category_id: choice })
      continue
    }

    const kind = categoryCreateKinds[source.id]
    if (!kind) {
      addError(getImportCategoryTypeRequiredError(source.label))
      continue
    }
    if (source.role === 'transfer' && !canCarryActualTransfer({ kind, name: source.createName })) {
      addError(getActualTransferCategoryError(source.label))
      continue
    }

    // A new category reuses one of the same name, capitals folded, and one name records one
    // direction, so either clash is what the commit would refuse
    const reused = findReusedImportCategory(source.createName, categoryById.values())
    if (reused && reused.kind !== kind) {
      addError(getCategoryDirectionClashError(source.label, reused.name, reused.kind))
      continue
    }
    const key = getCategoryNameKey(source.createName)
    const earlier = createdByKey.get(key)
    if (earlier && earlier.kind !== kind) {
      addError(getActualCategoryCreateClashError(earlier.label, source.label))
      continue
    }
    createdByKey.set(key, { label: source.label, kind })

    categories.push({ source: source.id, create: { name: source.createName, kind, icon: DEFAULT_CATEGORY_ICON } })
  }

  return categories
}

/**
 * Writes each entry in its accounts' currency, leaving out one whose amount the currency can't
 * hold. An entry whose account has no currency yet waits for the answer, which the errors report
 */
function buildRows(journal: ActualJournal, accountCurrencies: Map<string, string>, currencies: Currency[]) {
  const rows: JournalImportRow[] = []
  const skippedRows: ActualSkippedRow[] = []
  const writtenCategorySources = new Set<string>()
  const accountName = new Map(journal.accounts.map((account) => [account.id, account.name]))

  for (const entry of journal.entries) {
    const accountId = entry.sourceAccountId ?? entry.destinationAccountId
    const currency = accountId ? accountCurrencies.get(accountId) : undefined
    const exponent = currency ? findCurrencyExponent(currencies, currency) : null
    if (!currency || exponent === null) continue

    const amount = formatScaledAmount(entry.amount, ACTUAL_TRANSACTION_DECIMALS, exponent)
    if (amount === null) {
      skippedRows.push(describeEntry(entry, accountName, getActualAmountPrecisionReason(formatHundredths(entry.amount), currency)))
      continue
    }

    if (entry.categorySourceId) writtenCategorySources.add(entry.categorySourceId)
    const isDeposit = entry.type === 'deposit'
    rows.push({
      journal_id: entry.transactionId,
      type: entry.type,
      dt: entry.date,
      amount,
      currency_code: currency,
      foreign_amount: null,
      foreign_currency_code: null,
      description: null,
      source_account: entry.sourceAccountId,
      source_name: isDeposit ? entry.payeeName : null,
      destination_account: entry.destinationAccountId,
      destination_name: entry.type === 'withdrawal' ? entry.payeeName : null,
      category: entry.categorySourceId,
      category_leg: entry.categoryLeg,
      tag_names: entry.tags,
      notes: entry.notes,
    })
  }

  return { rows, skippedRows, writtenCategorySources }
}

function describeEntry(entry: ActualJournalEntry, accountName: Map<string, string>, reason: string): ActualSkippedRow {
  const isOutflow = entry.sourceAccountId !== null
  return {
    transactionId: entry.transactionId,
    date: entry.date,
    accountName: accountName.get(entry.sourceAccountId ?? entry.destinationAccountId ?? '') ?? '',
    amount: isOutflow ? -entry.amount : entry.amount,
    payeeName: entry.payeeName,
    categoryName: null,
    notes: entry.notes,
    reason,
  }
}
