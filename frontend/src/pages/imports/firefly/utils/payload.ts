import type { AccountsOverview } from '@/api/accounts'
import type { Category } from '@/api/categories'
import type { JournalImportPayload } from '@/api/provider-imports'
import {
  CREATE_ACCOUNT_VALUE,
  getImportNoRowsError,
  getTooManyMappingsError,
  MAX_IMPORT_MAPPINGS,
  IMPORT_ACCOUNT_NAME_MAX_LENGTH,
} from '@/pages/imports/constants'
import type { CsvRow, ImportAccountCreateDetails, ImportCategoryKind, ImportCategoryRename, ImportFileDraft } from '@/pages/imports/types'
import { FIREFLY_TYPE_DEPOSIT } from '@/pages/imports/firefly/constants'
import type { FireflyAccountSources, FireflyImportBuildResult } from '@/pages/imports/firefly/types'
import { buildImportAccountMapping, buildImportCategoryMapping } from '@/pages/imports/utils/importMappings'
import {
  getFireflyRowAmounts,
  getFireflyRowCategorySource,
  getFireflyRowDate,
  getFireflyRowPayeeName,
  getFireflyRowSentNotes,
  getFireflySplitGroupSizes,
  isFireflyPayeeRow,
  isFireflyRowUploadable,
  splitFireflyTags,
  toFireflyUnsignedAmount,
} from './derivation'

/**
 * Compiles the staged Firefly III import into the backend payload, returning
 * blocking errors instead when the staging is incomplete
 */
export function buildFireflyImportPayload({
  transactionsFile,
  rows,
  skippedRows,
  accountSources,
  accountMappings,
  accountById,
  accountCreateDetails,
  importedCategories,
  categoryMappings,
  categoryCreateKinds,
  categoryRenames,
  categoryById,
}: {
  transactionsFile: ImportFileDraft | null
  rows: CsvRow[]

  /**
   * Rows the preview predicts cannot be written, left out so the commit, which refuses rather than
   * skips a row it cannot write, never receives one
   */
  skippedRows: ReadonlySet<CsvRow>
  accountSources: FireflyAccountSources
  accountMappings: Record<string, string>
  accountById: Map<string, AccountsOverview>
  accountCreateDetails: Record<string, ImportAccountCreateDetails>
  importedCategories: string[]
  categoryMappings: Record<string, string>
  categoryCreateKinds: Record<string, ImportCategoryKind>

  /** New categories created under another name, because an existing category holds their own */
  categoryRenames: Record<string, ImportCategoryRename>

  /** The user's categories, which a new category of the same name is created as */
  categoryById: Map<string, Category>
}): FireflyImportBuildResult {
  const errors: string[] = []
  const addError = (message: string) => {
    if (!errors.includes(message)) errors.push(message)
  }

  if (!transactionsFile) addError('Upload the transactions CSV file.')
  if (transactionsFile?.error) addError(`${transactionsFile.name}: ${transactionsFile.error}`)

  // One run holds up to this many distinct values of each kind across all its batches, so an
  // export past it is refused here rather than by the server part way through the upload
  if (accountSources.list.length > MAX_IMPORT_MAPPINGS) {
    addError(getTooManyMappingsError('account', accountSources.list.length))
  }
  if (importedCategories.length > MAX_IMPORT_MAPPINGS) {
    addError(getTooManyMappingsError('category', importedCategories.length))
  }

  const { rows: payloadRows, rowAccountSources, writtenCategorySources } = buildFireflyImportRows(
    rows,
    skippedRows,
    accountSources,
  )

  // A source only skipped rows use is still answered, but the commit creates nothing for it
  const accounts: JournalImportPayload['accounts'] = []
  const sentAccountSources = new Set<string>()
  const archiveAccountSources: string[] = []
  for (const { id: source, name, label, details } of accountSources.list) {
    const choice = accountMappings[source] ?? ''
    const hasRows = rowAccountSources.has(source)
    const isCreate = choice === CREATE_ACCOUNT_VALUE

    // Only accounts the rows use are sent, plus the empty accounts the import creates from the
    // accounts export. An existing account only that export lists takes nothing, so its answer is
    // kept but not sent, and only an account the import creates is archived
    const isSent = hasRows || (isCreate && details !== null)
    const built = buildImportAccountMapping({
      source,
      label,
      name,
      choice,
      createDetails: accountCreateDetails[source],
      accountById,
      // An existing account only the accounts export lists takes no rows, so its state is not checked
      takesRows: hasRows || details === null,
      refusesGroupAccount: true,
      getNameTooLongError: getFireflyAccountNameTooLongError,
    }, addError)
    if (!choice || !isSent) continue

    // Counted while its answer is still incomplete too, so the preview counts what the import creates
    sentAccountSources.add(source)
    if (isCreate && details && !details.isActive) archiveAccountSources.push(source)
    if (built) accounts.push(built.mapping)
  }

  const categories: JournalImportPayload['categories'] = []
  const createdByKey = new Map<string, { label: string; kind: ImportCategoryKind }>()
  for (const source of importedCategories) {
    const built = buildImportCategoryMapping({
      source,
      label: source,
      createName: source,
      choice: categoryMappings[source] ?? '',
      createKind: categoryCreateKinds[source],
      rename: categoryRenames[source],
      categoryById,
      createdByKey,
      refusesGroupCategory: true,
    }, addError)
    if (built) categories.push(built.mapping)
  }

  if (payloadRows.length === 0) addError(getImportNoRowsError('export'))

  const writtenSources = { accounts: sentAccountSources, categories: writtenCategorySources }
  if (errors.length > 0) return { errors, payload: null, writtenSources, archiveAccountSources }
  return { errors: [], payload: { accounts, categories, rows: payloadRows }, writtenSources, archiveAccountSources }
}

/**
 * Compiles journal rows into the backend row shape, leaving out the rows predicted to be skipped
 *
 * Every value goes in the one form the endpoint takes, which refuses any other rather than
 * cleaning it up: a lowercased type, amounts without their sign, and trimmed text, with a
 * missing value sent as null
 *
 * An endpoint the import writes to is sent as its account source alone, so the backend never works
 * out from the Firefly III type which endpoints are accounts. Another endpoint's name is sent only
 * where it becomes the merchant, and a category only where the row is written with it, so a long
 * value the import never writes cannot fail the import and an export of only transfers maps no category
 */
function buildFireflyImportRows(
  rows: CsvRow[],
  skippedRows: ReadonlySet<CsvRow>,
  accountSources: FireflyAccountSources,
): {
  rows: JournalImportPayload['rows']
  rowAccountSources: Set<string>
  writtenCategorySources: Set<string>
} {
  const payloadRows: JournalImportPayload['rows'] = []
  const rowAccountSources = new Set<string>()
  const writtenCategorySources = new Set<string>()

  // Read over every row, skipped ones included, since a split's notes name the whole group
  const groupSizes = getFireflySplitGroupSizes(rows)

  for (const row of rows) {
    if (skippedRows.has(row) || !isFireflyRowUploadable(row, groupSizes)) continue

    const sourceAccount = accountSources.find(row.source_name, row.source_type)
    const destinationAccount = accountSources.find(row.destination_name, row.destination_type)
    const { main, foreign } = getFireflyRowAmounts(row)
    if (!main) continue

    // Only the payee a withdrawal pays or a deposit comes from is written, as the merchant
    const payeeName = getFireflyRowPayeeName(row) || null
    const isDeposit = row.type.trim().toLowerCase() === FIREFLY_TYPE_DEPOSIT
    // A payee row without a category is sent with the no-category source for its direction by name,
    // since the commit would file a null category under (no category), money in included
    const category = isFireflyPayeeRow(row) ? getFireflyRowCategorySource(row) : null

    if (sourceAccount) rowAccountSources.add(sourceAccount.id)
    if (destinationAccount) rowAccountSources.add(destinationAccount.id)
    if (category) writtenCategorySources.add(category)

    payloadRows.push({
      journal_id: row.journal_id.trim(),
      type: row.type.trim().toLowerCase(),
      dt: getFireflyRowDate(row.date ?? ''),
      amount: toFireflyUnsignedAmount(main.amount),
      currency_code: main.currencyCode,
      foreign_amount: foreign ? toFireflyUnsignedAmount(foreign.amount) : null,
      foreign_currency_code: foreign?.currencyCode ?? null,
      description: cleanOptional(row.description),
      source_account: sourceAccount?.id ?? null,
      source_name: isDeposit ? payeeName : null,
      destination_account: destinationAccount?.id ?? null,
      destination_name: isDeposit ? null : payeeName,
      category,
      tag_names: splitFireflyTags(row.tags ?? ''),
      notes: getFireflyRowSentNotes(row, groupSizes),
    })
  }

  return { rows: payloadRows, rowAccountSources, writtenCategorySources }
}

function getFireflyAccountNameTooLongError(label: string) {
  return `Map to an existing account, since a new account name holds at most ${IMPORT_ACCOUNT_NAME_MAX_LENGTH} characters: ${label}`
}

function cleanOptional(value: string | undefined) {
  const trimmed = value?.trim() ?? ''
  return trimmed || null
}
