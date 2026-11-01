import type {
  ColumnMap,
  ImportAmountDirection,
  ImportCategoryKind,
  ImportDateRange,
  ImportFileDraft,
} from '@/pages/imports/types'
import type { ImportAmountFormat } from './amountFormats'
import type { ImportFormatChoiceState } from './formatChoices'
import type { ScopedImportAnswers } from './scopedAnswers'
import type { ImportDateFormat } from './valueParsers'

/**
 * Everything a CSV import's result depends on. The import run compares these by identity, so a part
 * missing here would let an upload kept from an interrupted save be saved after that part changed
 */
export type CsvImportAnswers = {
  files: ImportFileDraft[]
  storedColumnMap: ColumnMap
  fixedAccountId: string | null
  scopedAccountMappings: ScopedImportAnswers<string>
  accountCreateTypes: Record<string, string>
  accountCreateCurrencies: Record<string, string>
  accountCreateInstitutions: Record<string, string>
  dateFormatChoice: ImportFormatChoiceState<ImportDateFormat>
  dateRange: ImportDateRange
  amountFormatChoice: ImportFormatChoiceState<ImportAmountFormat>
  scopedDirectionAnswers: ScopedImportAnswers<ImportAmountDirection>
  scopedCategoryMappings: ScopedImportAnswers<string>
  scopedCategoryCreateKinds: ScopedImportAnswers<ImportCategoryKind>
  scopedCategoryCreateNames: ScopedImportAnswers<string>
  scopedMerchantMappings: ScopedImportAnswers<string>
  scopedMerchantCreateNames: ScopedImportAnswers<string>
  scopedTagMappings: ScopedImportAnswers<string>
  scopedTagCreateNames: ScopedImportAnswers<string>
}

/**
 * Keeps the earlier answers where every part is still the same object, and takes the new ones as soon
 * as any part changed
 *
 * Compared part by part rather than through a list of dependencies, so a part added to the answers
 * can't be left out of what decides whether they changed
 */
export function keepUnchangedImportAnswers<T extends object>(previous: T, next: T): T {
  const keys = Object.keys(next) as (keyof T)[]
  const isUnchanged =
    keys.length === Object.keys(previous).length && keys.every((key) => Object.is(previous[key], next[key]))
  return isUnchanged ? previous : next
}
