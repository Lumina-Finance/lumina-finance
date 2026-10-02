import type { AccountsOverview } from '@/api/accounts'
import type { Category } from '@/api/categories'
import { JOURNAL_NO_CATEGORY_SOURCE, type JournalImportPayload } from '@/api/provider-imports'
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
  getImportGroupAccountError,
  getImportGroupCategoryError,
  getImportNoRowsError,
  getTooManyMappingsError,
  MAX_IMPORT_MAPPINGS,
} from '@/pages/imports/constants'
import type { CsvRow, ImportCategoryKind, ImportCategoryRename, ImportFileDraft } from '@/pages/imports/types'
import { FIREFLY_ACCOUNT_NAME_MAX_LENGTH, FIREFLY_TYPE_DEPOSIT } from '@/pages/imports/firefly/constants'
import type { FireflyAccountSources, FireflyImportBuildResult } from '@/pages/imports/firefly/types'
import { isImportAccountType } from '@/pages/imports/accountTypeGuard'
import { isImportableAccount } from '@/pages/imports/utils/accountScope'
import { checkImportCategoryCreate } from '@/pages/imports/utils/categoryMatching'
import { isGroupResource } from '@/pages/imports/utils/resourceScope'
import {
  countCharacters,
  getFireflyRowAmounts,
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
  accountCreateDetails: Record<string, FireflyAccountCreateDetails>
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

  // Only accounts the rows use are sent, plus those from the accounts export the import creates
  // empty. A source only skipped rows use is still answered, but the commit creates nothing for it
  const accounts: JournalImportPayload['accounts'] = []
  const sentAccountSources = new Set<string>()
  const archiveAccountSources: string[] = []
  for (const { id: source, name, label, details } of accountSources.list) {
    const choice = accountMappings[source]
    if (!choice) {
      addError(getImportAccountMappingError(label))
      continue
    }

    const hasRows = rowAccountSources.has(source)
    const isCreate = choice === CREATE_ACCOUNT_VALUE

    // No group account is offered, so one still chosen is a stale answer, refused wherever it
    // points. Imports write only the user's own records
    const existing = isCreate ? undefined : accountById.get(choice)
    if (existing && isGroupResource(existing)) {
      addError(getImportGroupAccountError(label))
      continue
    }

    // An existing account only the accounts export lists takes nothing, so its answer is kept but
    // otherwise neither checked nor sent
    if (!isCreate && !hasRows && details) continue

    // Only an account the import creates is archived, so one the user already has is left as it is
    const isSent = hasRows || (isCreate && details !== null)
    if (isSent) sentAccountSources.add(source)
    if (isCreate && details && !details.isActive) archiveAccountSources.push(source)

    if (!isCreate) {
      // Every source still here takes rows, and an archived or read-only account takes none, so an
      // account archived or made read-only after it was chosen is refused here rather than by the
      // server part way through the import
      if (existing && !isImportableAccount(existing)) {
        addError(getImportReadOnlyAccountMappingError(label, existing))
        continue
      }

      if (isSent) accounts.push({ source, account_id: choice })
      continue
    }

    // Firefly III takes longer account names than Lumina does, and the name is the only thing a
    // new account could carry over, so such an account can only be mapped to an existing one
    if (countCharacters(name) > FIREFLY_ACCOUNT_NAME_MAX_LENGTH) {
      addError(getFireflyAccountNameTooLongError(label))
      continue
    }

    const createDetails = accountCreateDetails[source]
    if (!createDetails?.accountType) addError(getImportAccountTypeRequiredError(label))
    if (!createDetails?.currency) addError(getImportAccountCurrencyRequiredError(label))
    if (!createDetails?.accountType || !createDetails.currency) continue

    if (!isImportAccountType(createDetails.accountType)) {
      addError(getImportAccountTypeUnsupportedError(label))
      continue
    }

    if (!isSent) continue
    accounts.push({
      source,
      create: {
        name,
        account_type: createDetails.accountType,
        currency: createDetails.currency.toUpperCase(),
        institution_id: createDetails.institutionId || null,
      },
    })
  }

  const categories: JournalImportPayload['categories'] = []
  const createdCategoryByKey = new Map<string, { label: string; kind: ImportCategoryKind }>()
  for (const source of importedCategories) {
    const choice = categoryMappings[source]
    if (!choice) {
      addError(getImportCategoryMappingError(source))
      continue
    }

    if (choice !== CREATE_CATEGORY_VALUE) {
      const category = categoryById.get(choice)
      if (category && isGroupResource(category)) {
        addError(getImportGroupCategoryError(source))
        continue
      }
      categories.push({ source, category_id: choice })
      continue
    }

    const kind = categoryCreateKinds[source]
    if (!kind) {
      addError(getImportCategoryTypeRequiredError(source))
      continue
    }

    const rename = categoryRenames[source]
    const name = rename?.name.trim() ?? source
    const createError = checkImportCategoryCreate({
      label: source,
      name,
      isRenamed: rename !== undefined,
      kind,
      categoryById,
      createdByKey: createdCategoryByKey,
    })
    if (createError) {
      addError(createError)
      continue
    }

    categories.push({
      source,
      create: {
        name,
        kind,
        icon: DEFAULT_CATEGORY_ICON,
      },
    })
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
    const category = isFireflyPayeeRow(row) ? cleanOptional(row.category) : null

    if (sourceAccount) rowAccountSources.add(sourceAccount.id)
    if (destinationAccount) rowAccountSources.add(destinationAccount.id)

    // The commit files a payee row without a category under the no-category source
    if (isFireflyPayeeRow(row)) writtenCategorySources.add(category ?? JOURNAL_NO_CATEGORY_SOURCE)

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
  return `Map to an existing account, since a new account name holds at most ${FIREFLY_ACCOUNT_NAME_MAX_LENGTH} characters: ${label}`
}

function cleanOptional(value: string | undefined) {
  const trimmed = value?.trim() ?? ''
  return trimmed || null
}
