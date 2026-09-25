import type { AccountsOverview } from '@/api/accounts'
import type {
  FireflyTransactionImportPayload,
  FireflyTransactionImportResponse,
} from '@/api/firefly-imports'
import {
  CREATE_ACCOUNT_VALUE,
  CREATE_CATEGORY_VALUE,
  DEFAULT_CATEGORY_ICON,
  getImportAccountCurrencyRequiredError,
  getImportAccountMappingError,
  getImportAccountTypeRequiredError,
  getImportAccountTypeUnsupportedError,
  getImportReadOnlyAccountMappingError,
  getImportCategoryMappingError,
  getImportCategoryTypeRequiredError,
  getImportNoRowsError,
} from '@/pages/imports/constants'
import type { CsvRow, ImportCategoryKind, ImportFileDraft } from '@/pages/imports/types'
import { FIREFLY_ACCOUNT_NAME_MAX_LENGTH } from '@/pages/imports/firefly/constants'
import type { FireflyAccountSources, FireflyImportBuildResult } from '@/pages/imports/firefly/types'
import { isImportAccountType } from '@/pages/imports/accountTypeGuard'
import { isImportableAccount } from '@/pages/imports/utils/accountScope'
import { getFireflyRowDate, isFireflyRowUploadable, splitFireflyTags } from './derivation'

/**
 * Create-new selections for one tracked account after prefills are applied
 */
export interface FireflyAccountCreateDetails {
  accountType: string
  currency: string
  institutionId: string
}

/**
 * Compiles the staged Firefly III import into the backend payload, returning
 * blocking errors instead when the staging is incomplete
 */
export function buildFireflyImportPayload({
  transactionsFile,
  rows,
  accountSources,
  accountMappings,
  accountById,
  accountCreateDetails,
  importedCategories,
  categoryMappings,
  categoryCreateKinds,
}: {
  transactionsFile: ImportFileDraft | null
  rows: CsvRow[]
  accountSources: FireflyAccountSources
  accountMappings: Record<string, string>
  accountById: Map<string, AccountsOverview>
  accountCreateDetails: Record<string, FireflyAccountCreateDetails>
  importedCategories: string[]
  categoryMappings: Record<string, string>
  categoryCreateKinds: Record<string, ImportCategoryKind>
}): FireflyImportBuildResult {
  const errors: string[] = []
  const addError = (message: string) => {
    if (!errors.includes(message)) errors.push(message)
  }

  if (!transactionsFile) addError('Upload the transactions CSV file.')
  if (transactionsFile?.error) addError(`${transactionsFile.name}: ${transactionsFile.error}`)

  const accounts: FireflyTransactionImportPayload['accounts'] = []
  for (const { id: source, name, label } of accountSources.list) {
    const choice = accountMappings[source]
    if (!choice) {
      addError(getImportAccountMappingError(label))
      continue
    }

    if (choice !== CREATE_ACCOUNT_VALUE) {
      // Every Firefly source takes rows, and an archived or read-only account takes none, so an
      // account archived or made read-only after it was chosen is refused here rather than by the
      // server part way through the import
      const account = accountById.get(choice)
      if (account && !isImportableAccount(account)) {
        addError(getImportReadOnlyAccountMappingError(label, account))
        continue
      }

      accounts.push({ source, account_id: choice })
      continue
    }

    // Firefly III takes longer account names than Lumina does, and the name is the only thing a
    // new account could carry over, so such an account can only be mapped to an existing one
    if (name.length > FIREFLY_ACCOUNT_NAME_MAX_LENGTH) {
      addError(getFireflyAccountNameTooLongError(label))
      continue
    }

    const details = accountCreateDetails[source]
    if (!details?.accountType) addError(getImportAccountTypeRequiredError(label))
    if (!details?.currency) addError(getImportAccountCurrencyRequiredError(label))
    if (!details?.accountType || !details.currency) continue

    if (!isImportAccountType(details.accountType)) {
      addError(getImportAccountTypeUnsupportedError(label))
      continue
    }

    accounts.push({
      source,
      create: {
        name,
        account_type: details.accountType,
        currency: details.currency.toUpperCase(),
        institution_id: details.institutionId || null,
      },
    })
  }

  if (accountSources.list.length === 0 && rows.length > 0) {
    addError('This export has no asset or liability accounts to import into.')
  }

  const categories: FireflyTransactionImportPayload['categories'] = []
  for (const source of importedCategories) {
    const choice = categoryMappings[source]
    if (!choice) {
      addError(getImportCategoryMappingError(source))
      continue
    }

    if (choice !== CREATE_CATEGORY_VALUE) {
      categories.push({ source, category_id: choice })
      continue
    }

    const kind = categoryCreateKinds[source]
    if (!kind) {
      addError(getImportCategoryTypeRequiredError(source))
      continue
    }

    categories.push({
      source,
      create: {
        name: source,
        kind,
        icon: DEFAULT_CATEGORY_ICON,
      },
    })
  }

  const payloadRows = buildFireflyImportRows(rows, accountSources)
  if (payloadRows.length === 0) addError(getImportNoRowsError('export'))

  if (errors.length > 0) return { errors, payload: null }
  return { errors: [], payload: { accounts, categories, rows: payloadRows } }
}

/**
 * Compiles journal rows into the backend row shape, excluding rows missing the
 * identity fields the endpoint rejects at the request level
 *
 * An endpoint the import writes to is sent as its account source alone, and any other endpoint by
 * its name, so the backend never works out from the Firefly III type which endpoints are accounts
 */
function buildFireflyImportRows(
  rows: CsvRow[],
  accountSources: FireflyAccountSources,
): FireflyTransactionImportPayload['rows'] {
  const payloadRows: FireflyTransactionImportPayload['rows'] = []

  for (const row of rows) {
    if (!isFireflyRowUploadable(row)) continue

    const sourceAccount = accountSources.find(row.source_name, row.source_type)
    const destinationAccount = accountSources.find(row.destination_name, row.destination_type)

    payloadRows.push({
      journal_id: row.journal_id.trim(),
      type: row.type?.trim() ?? '',
      dt: getFireflyRowDate(row.date ?? ''),
      amount: row.amount.trim(),
      currency_code: row.currency_code.trim().toUpperCase(),
      foreign_amount: cleanOptional(row.foreign_amount),
      foreign_currency_code: cleanOptional(row.foreign_currency_code)?.toUpperCase() ?? null,
      description: cleanOptional(row.description),
      source_account: sourceAccount?.id ?? null,
      source_name: sourceAccount ? null : cleanOptional(row.source_name),
      destination_account: destinationAccount?.id ?? null,
      destination_name: destinationAccount ? null : cleanOptional(row.destination_name),
      category: cleanOptional(row.category),
      tag_names: splitFireflyTags(row.tags ?? ''),
      notes: cleanOptional(row.notes),
    })
  }

  return payloadRows
}

function getFireflyAccountNameTooLongError(label: string) {
  return `Map to an existing account, since a new account name holds at most ${FIREFLY_ACCOUNT_NAME_MAX_LENGTH} characters: ${label}`
}

function cleanOptional(value: string | undefined) {
  const trimmed = value?.trim() ?? ''
  return trimmed || null
}

/**
 * Formats the merged import response into the overlay summary line
 *
 * Budgets only join the line when the commit imported some, so a run without a
 * budgets export reads exactly as it did before
 */
export function formatFireflyImportSummary(
  result: FireflyTransactionImportResponse,
  {
    browserDroppedCount,
    budgetsCreated,
  }: {
    browserDroppedCount: number
    budgetsCreated: number
  },
) {
  const skippedCount = browserDroppedCount + result.rows_skipped
  const parts = [
    `${result.rows_imported} row${result.rows_imported === 1 ? '' : 's'} imported`,
    `${result.transactions_created} transaction${result.transactions_created === 1 ? '' : 's'} created`,
    `${skippedCount} skipped`,
  ]
  if (budgetsCreated > 0) {
    parts.push(`${budgetsCreated} budget${budgetsCreated === 1 ? '' : 's'} imported`)
  }

  return parts.join(' · ')
}
