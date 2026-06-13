import type { AccountsOverview } from '@/api/accounts'
import type { Category } from '@/api/categories'
import type { Currency } from '@/api/currency'
import type { Institution } from '@/api/institutions'
import type { DropdownOption } from '@/components/Dropdown'
import {
  ACCOUNT_KIND_LABELS,
  COLUMN_TARGETS,
  CREATE_ACCOUNT_VALUE,
  CREATE_CATEGORY_VALUE,
  DEFAULT_CATEGORY_ICON,
  KIND_LABELS,
} from '../constants'
import type { ColumnMap, ImportAccountSource, ImportFileDraft } from '../types'
import { getImportAccountName } from './accountMapping'
import { splitImportedValues } from './categoryMatching'
import { unique } from './common'

/**
 * Builds account dropdown options with the create-account action pinned first
 */
export function buildImportAccountOptions(accounts: AccountsOverview[]): DropdownOption[] {
  return [
    { value: CREATE_ACCOUNT_VALUE, label: 'Create New Account', group: 'Import Action' },
    ...accounts.map((account) => ({
      value: account.id,
      label: account.name,
      group: ACCOUNT_KIND_LABELS[account.account_kind],
    })),
  ]
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
      .sort((a, b) => a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name))
      .map((category) => ({
        value: category.id,
        label: category.name,
        group: KIND_LABELS[category.kind],
        icon: category.icon ?? DEFAULT_CATEGORY_ICON,
      })),
  ]
}

/**
 * Builds import column target options grouped by required and optional fields
 */
export function buildColumnTargetOptions(): DropdownOption[] {
  return [
    { value: '', label: 'Do not import' },
    ...COLUMN_TARGETS.map((target) => ({
      value: target.id,
      label: target.label,
      group: target.required ? 'Required fields' : 'Optional fields',
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
 */
export function getMissingRequiredColumnLabels(columnMap: ColumnMap): string[] {
  return COLUMN_TARGETS
    .filter((target) => target.required && !columnMap[target.id])
    .map((target) => target.label)
}

/**
 * Builds account mapping sources from either an account column or selected file names
 */
export function buildImportAccountMappingSources(
  files: ImportFileDraft[],
  accountHeader: string,
): ImportAccountSource[] {
  if (accountHeader) {
    return getUniqueColumnValues(files, accountHeader).map((source) => ({
      id: source,
      label: source,
      matchText: source,
    }))
  }

  return files.map((file) => ({
    id: file.id,
    label: getImportAccountName(file.name),
    matchText: file.name,
  }))
}

/**
 * Gets sorted imported category names from the mapped category column
 */
export function getImportedCategories(files: ImportFileDraft[], categoryHeader: string): string[] {
  if (!categoryHeader) return []
  return getUniqueColumnValues(files, categoryHeader).sort((a, b) => a.localeCompare(b))
}

/**
 * Gets sorted imported merchant names from the mapped merchant column
 */
export function getImportedMerchants(files: ImportFileDraft[], merchantHeader: string): string[] {
  if (!merchantHeader) return []
  return getUniqueColumnValues(files, merchantHeader).sort((a, b) => a.localeCompare(b))
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
