import type { AccountType } from '@/api/accounts'
import type {
  FireflyTransactionImportPayload,
  FireflyTransactionImportResponse,
} from '@/api/dataImports'
import {
  ACCOUNT_TYPE_OPTIONS,
  CREATE_ACCOUNT_VALUE,
  CREATE_CATEGORY_VALUE,
  DEFAULT_CATEGORY_ICON,
} from '../../constants'
import type { CsvRow, ImportCategoryKind, ImportFileDraft } from '../../types'
import type { FireflyImportBuildResult } from '../types'
import { getFireflyRowDate, isFireflyRowImportable, splitFireflyTags } from './derivation'

/**
 * Create-new selections for one tracked account name after prefills are applied
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
  trackedAccountNames,
  accountMappings,
  accountCreateDetails,
  importedCategories,
  categoryMappings,
  categoryCreateKinds,
}: {
  transactionsFile: ImportFileDraft | null
  rows: CsvRow[]
  trackedAccountNames: string[]
  accountMappings: Record<string, string>
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
  for (const name of trackedAccountNames) {
    const choice = accountMappings[name]
    if (!choice) {
      addError(`Map account: ${name}`)
      continue
    }

    if (choice !== CREATE_ACCOUNT_VALUE) {
      accounts.push({ source: name, account_id: choice })
      continue
    }

    const details = accountCreateDetails[name]
    if (!details?.accountType) addError(`Choose account type: ${name}`)
    if (!details?.currency) addError(`Choose account currency: ${name}`)
    if (!details?.accountType || !details.currency) continue

    if (!isImportAccountType(details.accountType)) {
      addError(`Invalid account type: ${name}`)
      continue
    }

    accounts.push({
      source: name,
      create: {
        name,
        account_type: details.accountType,
        currency: details.currency.toUpperCase(),
        institution_id: details.institutionId || null,
      },
    })
  }

  if (trackedAccountNames.length === 0 && rows.length > 0) {
    addError('No asset or liability accounts were found in the transactions file.')
  }

  const categories: FireflyTransactionImportPayload['categories'] = []
  for (const source of importedCategories) {
    const choice = categoryMappings[source]
    if (!choice) {
      addError(`Map category: ${source}`)
      continue
    }

    if (choice !== CREATE_CATEGORY_VALUE) {
      categories.push({ source, category_id: choice })
      continue
    }

    const kind = categoryCreateKinds[source]
    if (!kind) {
      addError(`Choose category type: ${source}`)
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

  const payloadRows = buildFireflyImportRows(rows)
  if (payloadRows.length === 0) addError('No transaction rows are available to import.')

  if (errors.length > 0) return { errors, payload: null }
  return { errors: [], payload: { accounts, categories, rows: payloadRows } }
}

/**
 * Compiles journal rows into the backend row shape, excluding rows missing the
 * identity fields the endpoint rejects at the request level
 */
function buildFireflyImportRows(rows: CsvRow[]): FireflyTransactionImportPayload['rows'] {
  const payloadRows: FireflyTransactionImportPayload['rows'] = []

  for (const row of rows) {
    if (!isFireflyRowImportable(row)) continue

    payloadRows.push({
      journal_id: row.journal_id.trim(),
      type: row.type?.trim() ?? '',
      dt: getFireflyRowDate(row.date ?? ''),
      amount: row.amount.trim(),
      currency_code: row.currency_code.trim().toUpperCase(),
      foreign_amount: cleanOptional(row.foreign_amount),
      foreign_currency_code: cleanOptional(row.foreign_currency_code)?.toUpperCase() ?? null,
      description: cleanOptional(row.description),
      source_name: cleanOptional(row.source_name),
      source_type: cleanOptional(row.source_type),
      destination_name: cleanOptional(row.destination_name),
      destination_type: cleanOptional(row.destination_type),
      category: cleanOptional(row.category),
      tag_names: splitFireflyTags(row.tags ?? ''),
      notes: cleanOptional(row.notes),
    })
  }

  return payloadRows
}

function isImportAccountType(value: string): value is AccountType {
  return ACCOUNT_TYPE_OPTIONS.some((option) => option.value === value)
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
export function formatFireflyImportSummary(result: FireflyTransactionImportResponse, budgetsCreated = 0) {
  const parts = [
    `${result.rows_imported} row${result.rows_imported === 1 ? '' : 's'} imported`,
    `${result.transactions_created} transaction${result.transactions_created === 1 ? '' : 's'} created`,
    `${result.rows_skipped} skipped`,
  ]
  if (budgetsCreated > 0) {
    parts.push(`${budgetsCreated} budget${budgetsCreated === 1 ? '' : 's'} imported`)
  }

  return parts.join(' · ')
}
