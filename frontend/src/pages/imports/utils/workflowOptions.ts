import type { AccountsOverview } from '@/api/accounts'
import type { Category } from '@/api/categories'
import type { Currency } from '@/api/currency'
import type { Institution } from '@/api/institutions'
import type { DropdownOption } from '@/components/dropdown/Dropdown'
import {
  ACCOUNT_KIND_LABELS,
  ACCOUNT_KIND_RANKS,
  AMOUNT_ARRANGEMENT_CLASH_ERROR,
  AMOUNT_ARRANGEMENT_CLASH_TITLE,
  COLUMN_TARGET_GROUP_LABELS,
  COLUMN_TARGET_GROUP_RANKS,
  COLUMN_TARGETS,
  CREATE_ACCOUNT_VALUE,
  CREATE_CATEGORY_VALUE,
  CURRENCIES_FAILED_UPLOAD_BLOCK,
  CURRENCIES_LOADING_UPLOAD_BLOCK,
  DEFAULT_CATEGORY_ICON,
  DIRECTION_ARRANGEMENT_CLASH_ERROR,
  DIRECTION_ARRANGEMENT_CLASH_TITLE,
  KIND_LABELS,
  KIND_RANKS,
  MISSING_AMOUNT_COLUMN_LABEL,
} from '@/pages/imports/constants'
import { getMerchantNameKey } from '@/api/shared/merchantNameKey'
import type {
  ColumnMap,
  CsvRow,
  ImportAccountSource,
  ImportFileDraft,
  ImportUploadBlock,
} from '@/pages/imports/types'
import { getImportAccountName } from './accountMapping'
import { splitImportedValues } from './categoryMatching'
import { unique } from './common'

// Marks an account that is hidden everywhere else in the app, kept short because it renders as a
// pill beside the account name. Only the counterparty list offers one, since nothing is written to
// the account it records
const ARCHIVED_ACCOUNT_BADGE = 'Archived'

/**
 * Builds account dropdown options with the create-account action pinned first, sorted by kind and
 * then by name
 */
export function buildImportAccountOptions(accounts: AccountsOverview[]): DropdownOption[] {
  return [
    { value: CREATE_ACCOUNT_VALUE, label: 'Create New Account', group: 'Import Action' },
    ...accounts
      .slice()
      .sort((a, b) => ACCOUNT_KIND_RANKS[a.account_kind] - ACCOUNT_KIND_RANKS[b.account_kind] || a.name.localeCompare(b.name))
      .map((account) => ({
        value: account.id,
        label: account.name,
        group: ACCOUNT_KIND_LABELS[account.account_kind],
        badge: account.is_archived ? ARCHIVED_ACCOUNT_BADGE : undefined,
      })),
  ]
}

/**
 * Collects the currency codes the app supports, for the checks that only ask whether a cell holds
 * one of them
 *
 * Built once from the loaded list and passed down, rather than each check scanning the list, since
 * header detection asks the question for every cell of a file's first row
 */
export function getSupportedCurrencyCodes(currencies: Currency[]) {
  return new Set(currencies.map((currency) => currency.id))
}

/**
 * Says why a file cannot be uploaded yet, or null when it can
 *
 * Both flows read a file against the currency list, and which cells hold a currency is decided
 * once and kept on the staged file, so a file read before that list arrives stays wrong afterwards
 *
 * The list being empty is what actually blocks, rather than the two query flags: a request the
 * browser has not started, which is what an offline page has, reports neither loading nor failed
 * while still having no list to read against
 *
 * `isFailure` separates the two, because waiting a moment on an ordinary page load should not be
 * dressed as an error while something the user has to act on should
 *
 * @param currencies - The currency list as it stands
 * @param currenciesError - Whether fetching the currency list failed
 */
export function getImportUploadBlockReason(
  currencies: Currency[],
  currenciesError: boolean,
): ImportUploadBlock | null {
  if (currencies.length > 0) return null

  return currenciesError
    ? { message: CURRENCIES_FAILED_UPLOAD_BLOCK, isFailure: true }
    : { message: CURRENCIES_LOADING_UPLOAD_BLOCK, isFailure: false }
}

/**
 * Builds currency dropdown options from loaded currency metadata
 */
export function buildImportCurrencyOptions(currencies: Currency[]): DropdownOption[] {
  return currencies.map((currency) => ({
    value: currency.id,
    label: currency.id,
  }))
}

/**
 * Builds institution dropdown options with the explicit none option first
 */
export function buildImportInstitutionOptions(institutions: Institution[]): DropdownOption[] {
  return [
    { value: '', label: 'None' },
    ...institutions.map((institution) => ({
      value: institution.id,
      label: institution.name,
    })),
  ]
}

/**
 * Builds category match options sorted by kind and name with the create-category action first
 */
export function buildImportCategoryMatchOptions(categories: Category[] = []): DropdownOption[] {
  return [
    {
      value: CREATE_CATEGORY_VALUE,
      label: 'Create new category',
      group: 'Import action',
    },
    ...categories
      .slice()
      .sort((a, b) => KIND_RANKS[a.kind] - KIND_RANKS[b.kind] || a.name.localeCompare(b.name))
      .map((category) => ({
        value: category.id,
        label: category.name,
        group: KIND_LABELS[category.kind],
        icon: category.icon ?? DEFAULT_CATEGORY_ICON,
      })),
  ]
}

/**
 * Builds import column target options grouped by how each field is required
 *
 * The list starts a new heading every time the group changes down the options, so the targets are
 * sorted by group rather than following the order the fields are declared in
 *
 * Each field's hint rides along as the option's description, which is where a user decides what a
 * column means. Ignoring a column needs no explanation, so that entry carries none
 *
 * @param omitAccountColumn - Whether the account field is left out, which is what an import started
 *   from an account does, since that account is the answer and no column may contradict it
 */
export function buildColumnTargetOptions({ omitAccountColumn = false } = {}): DropdownOption[] {
  const offeredTargets = omitAccountColumn
    ? COLUMN_TARGETS.filter((target) => target.id !== 'account_id')
    : COLUMN_TARGETS
  const targetsByGroup = [...offeredTargets].sort(
    (a, b) => COLUMN_TARGET_GROUP_RANKS[a.group] - COLUMN_TARGET_GROUP_RANKS[b.group],
  )

  return [
    { value: '', label: 'Do not import' },
    ...targetsByGroup.map((target) => ({
      value: target.id,
      label: target.label,
      group: COLUMN_TARGET_GROUP_LABELS[target.group],
      description: target.hint,
    })),
  ]
}

/**
 * Gets unique CSV headers across every selected file
 */
export function getImportHeaders(files: ImportFileDraft[]): string[] {
  return unique(files.flatMap((file) => file.headers))
}

/**
 * Lists required import columns that are still unmapped
 *
 * The three amount fields share one requirement between them, so they are reported as the single
 * label rather than one per field: mapping any of them answers it, and a file mapping the two sides
 * is not missing an Amount column
 */
export function getMissingRequiredColumnLabels(columnMap: ColumnMap): string[] {
  const missing = COLUMN_TARGETS
    .filter((target) => target.group === 'required' && !columnMap[target.id])
    .map((target) => target.label)

  const hasAmountArrangement = COLUMN_TARGETS.some(
    (target) => target.group === 'amount' && columnMap[target.id],
  )
  if (!hasAmountArrangement) missing.push(MISSING_AMOUNT_COLUMN_LABEL)

  return missing
}

/**
 * Reports why a file's amount mapping contradicts itself, or null where it does not
 *
 * A single signed column and the two sides written separately are alternatives, so a map holding
 * both states the amount twice with nothing to settle which reading wins. A Direction column beside
 * either side is the same fault about the direction rather than the amount, since a side already
 * carries its own direction
 *
 * @returns The title and message of the clash it found, both shown on the mapping step and the
 * message alone over the commit button
 */
export function getAmountArrangementClashError(columnMap: ColumnMap): { title: string; message: string } | null {
  const hasSide = Boolean(columnMap.amount_out || columnMap.amount_in)
  if (!hasSide) return null

  if (columnMap.amount) {
    return { title: AMOUNT_ARRANGEMENT_CLASH_TITLE, message: AMOUNT_ARRANGEMENT_CLASH_ERROR }
  }
  if (columnMap.amount_direction) {
    return { title: DIRECTION_ARRANGEMENT_CLASH_TITLE, message: DIRECTION_ARRANGEMENT_CLASH_ERROR }
  }

  return null
}

/**
 * Builds account mapping sources from either an account column or selected file names
 */
export function buildImportAccountMappingSources(
  files: ImportFileDraft[],
  accountHeader: string,
  counterpartyAccountHeader: string,
): ImportAccountSource[] {
  const rowSources: ImportAccountSource[] = accountHeader
    ? getUniqueColumnValues(files, accountHeader).map((source) => ({
      id: source,
      label: source,
      matchText: source,
      isCounterpartyOnly: false,
    }))
    : files.map((file) => ({
      id: file.id,
      label: getImportAccountName(file.name),
      matchText: file.name,
      isCounterpartyOnly: false,
    }))

  if (!counterpartyAccountHeader) return rowSources

  // A name appearing only as the counterparty account of a transfer still has to be mapped, and it
  // is the only kind that can be answered as money outside the tracked accounts, since no row is
  // written to it
  const rowSourceIds = new Set(rowSources.map((source) => source.id))
  const counterpartySources: ImportAccountSource[] = getUniqueColumnValues(files, counterpartyAccountHeader)
    .filter((source) => !rowSourceIds.has(source))
    .map((source) => ({
      id: source,
      label: source,
      matchText: source,
      isCounterpartyOnly: true,
    }))

  return [...rowSources, ...counterpartySources]
}

/**
 * Gets sorted imported category names from the mapped category column
 */
export function getImportedCategories(files: ImportFileDraft[], categoryHeader: string): string[] {
  if (!categoryHeader) return []
  return getUniqueColumnValues(files, categoryHeader).sort((a, b) => a.localeCompare(b))
}

/**
 * Reports whether one row states no payee
 *
 * With no column mapped as the Merchant every row states none, and with one mapped it is the rows
 * whose cell is blank
 */
function doesRowStateNoPayee(row: CsvRow, merchantHeader: string): boolean {
  return merchantHeader ? !row[merchantHeader]?.trim() : true
}

/**
 * Counts the rows across every staged file that state no payee
 *
 * Read from the merchant column alone, so the mapping step can say how many rows will be filed
 * under a merchant that ships with the app without waiting on the account and category answers
 */
export function countRowsWithNoPayee(files: ImportFileDraft[], merchantHeader: string): number {
  return files.reduce(
    (total, file) => total + file.rows.filter((row) => doesRowStateNoPayee(row, merchantHeader)).length,
    0,
  )
}

/**
 * Gets sorted imported merchant names from the mapped merchant column
 */
export function getImportedMerchants(files: ImportFileDraft[], merchantHeader: string): string[] {
  if (!merchantHeader) return []

  // One row per merchant the file resolves to rather than per spelling, since "Amazon" and "AMAZON"
  // are one payee. Two rows would let one be answered create and the other skip, with nothing to
  // say which answer the rows carrying either spelling should take
  const seenKeys = new Set<string>()
  const values: string[] = []
  for (const value of getUniqueColumnValues(files, merchantHeader)) {
    const key = getMerchantNameKey(value)
    if (seenKeys.has(key)) continue
    seenKeys.add(key)
    values.push(value)
  }

  return values.sort((a, b) => a.localeCompare(b))
}

/**
 * Gets sorted imported tag names from the mapped tag column
 */
export function getImportedTags(files: ImportFileDraft[], tagHeader: string): string[] {
  if (!tagHeader) return []
  return unique(
    files.flatMap((file) =>
      file.rows.flatMap((row) => splitImportedValues(row[tagHeader] ?? '')),
    ),
  ).sort((a, b) => a.localeCompare(b))
}

function getUniqueColumnValues(files: ImportFileDraft[], header: string): string[] {
  return unique(
    files.flatMap((file) =>
      file.rows.map((row) => row[header]?.trim()).filter(Boolean),
    ),
  )
}
