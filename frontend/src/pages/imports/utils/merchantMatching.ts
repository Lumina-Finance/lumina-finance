import type { Merchant } from '@/api/merchants'
import { getNameKey } from '@/api/shared/nameKey'
import type { TransactionImportMerchantMapping } from '@/api/transaction-imports'
import type { DropdownOption } from '@/components/dropdown/Dropdown'
import { CREATE_MERCHANT_VALUE, SKIP_MERCHANT_VALUE, UNKNOWN_MERCHANT_NAME } from '@/pages/imports/constants'
import type { PreviewTransactionRow } from '@/pages/imports/types'
import { buildImportNameMappings, getImportNameAnswer, getImportNameRowState } from './nameMatching'

/**
 * Builds the answers the merchant step offers for one merchant name
 *
 * The merchants offered are the ones the file's own values already match, plus whatever a search
 * turned up, since a person can have thousands and the page never holds them all
 *
 * @param merchants - Merchants to offer, from the file's matches and from the current search
 * @param pickedLabelsById - What merchants already picked are called, so one chosen through the
 *   search stays offerable once the search that found it is cleared
 */
export function buildImportMerchantOptions(
  merchants: Merchant[],
  pickedLabelsById: Record<string, string> = {},
): DropdownOption[] {
  const labelsById = new Map(Object.entries(pickedLabelsById))
  for (const merchant of merchants) labelsById.set(merchant.id, merchant.name)

  return [
    { value: CREATE_MERCHANT_VALUE, label: 'Create new merchant', group: 'Import action' },
    {
      value: SKIP_MERCHANT_VALUE,
      label: `Skip, filing rows under ${UNKNOWN_MERCHANT_NAME}`,
      group: 'Import action',
    },
    ...[...labelsById.entries()]
      .sort(([, first], [, second]) => first.localeCompare(second))
      .map(([id, label]) => ({
        value: id,
        label,
        group: 'Existing merchants',
      })),
  ]
}

/**
 * What one merchant name resolves to once the file's matches and the user's answer are both read
 *
 * @param answer - What the user chose for it, blank where they left it alone
 * @param matched - The merchant the value already matches, if any
 */
export function getImportMerchantRowState(answer: string, matched: Merchant | undefined) {
  return getImportNameRowState(answer, Boolean(matched), CREATE_MERCHANT_VALUE, SKIP_MERCHANT_VALUE)
}

/**
 * Builds the merchant answers the commit payload carries
 *
 * @param importedMerchants - One merchant name per merchant the file resolves to
 * @param matchedMerchantByKey - The merchants the file's values already match
 * @param merchantMappings - What the user chose for each value, blank where they left it alone
 * @param merchantCreateNames - The name the user wrote for a value being created
 */
export function buildImportMerchantMappings({
  importedMerchants,
  matchedMerchantByKey,
  merchantMappings,
  merchantCreateNames,
}: {
  importedMerchants: string[]
  matchedMerchantByKey: Map<string, Merchant>
  merchantMappings: Record<string, string>
  merchantCreateNames: Record<string, string>
}) {
  return buildImportNameMappings<Merchant, TransactionImportMerchantMapping>({
    values: importedMerchants,
    matchedByKey: matchedMerchantByKey,
    answers: merchantMappings,
    createNames: merchantCreateNames,
    createValue: CREATE_MERCHANT_VALUE,
    skipValue: SKIP_MERCHANT_VALUE,
    noun: 'merchant',
    buildChosen: (source, id) => ({ source, merchant_id: id }),

    // A merchant is written under the capitals it is given, so Amazon typed for AMAZON is a
    // correction. The commit still reuses a merchant held under the name in any capitals
    keepsCapitalCorrections: true,
  })
}
/**
 * Replaces the merchant name each preview row carries from the file with the one its transaction
 * will be filed under
 *
 * @param getFiledName - Says what a name from the file is filed under
 */
function fileRowsUnder(
  rows: PreviewTransactionRow[],
  getFiledName: (source: string) => string,
): PreviewTransactionRow[] {
  return rows.map((row) => {
    const source = row.transaction.merchant_name
    if (!source) return row

    const filedName = getFiledName(source)
    return filedName === source ? row : { ...row, transaction: { ...row.transaction, merchant_name: filedName } }
  })
}

/**
 * Shows each preview row under the merchant the commit will file it under, for an import with no
 * merchant step
 *
 * The commit matches a name to the merchant held under it in any capitals, and creates one under
 * the first spelling it meets where nothing matches, so every row of one merchant reads alike.
 * Rows come in the order the commit meets them, so the first spelling in them is the one it takes
 *
 * @param rows - The preview rows, in import order
 * @param matchedMerchantByKey - The merchants the rows' names already match
 */
export function fileRowsUnderMatchedMerchants(
  rows: PreviewTransactionRow[],
  matchedMerchantByKey: Map<string, Merchant>,
): PreviewTransactionRow[] {
  const firstSpellingByKey = new Map<string, string>()

  return fileRowsUnder(rows, (source) => {
    const key = getNameKey(source)
    const matched = matchedMerchantByKey.get(key)
    if (matched) return matched.name

    const firstSpelling = firstSpellingByKey.get(key) ?? source
    firstSpellingByKey.set(key, firstSpelling)
    return firstSpelling
  })
}

/**
 * Shows each preview row under the merchant the commit will file it under, reading the merchant
 * step's answers
 *
 * A row naming a merchant the step does not ask about, such as the one the import stamps on a row
 * stating none, is left as it is
 *
 * @param rows - The preview rows
 * @param importedMerchants - One merchant name per merchant the file resolves to, the names the
 *   step's answers are held under
 * @param matchedMerchantByKey - The merchants the file's names already match
 * @param merchantMappings - What the user chose for each name, blank where they left it alone
 * @param merchantCreateNames - The name the user wrote for a name being created
 * @param merchantNameById - What each merchant offered for a choice is called
 */
export function fileRowsUnderAnsweredMerchants({
  rows,
  importedMerchants,
  matchedMerchantByKey,
  merchantMappings,
  merchantCreateNames,
  merchantNameById,
}: {
  rows: PreviewTransactionRow[]
  importedMerchants: string[]
  matchedMerchantByKey: Map<string, Merchant>
  merchantMappings: Record<string, string>
  merchantCreateNames: Record<string, string>
  merchantNameById: Map<string, string>
}): PreviewTransactionRow[] {
  const valueByKey = new Map(importedMerchants.map((value) => [getNameKey(value), value]))

  return fileRowsUnder(rows, (source) => {
    const value = valueByKey.get(getNameKey(source))
    if (value === undefined) return source

    const matched = matchedMerchantByKey.get(getNameKey(value))
    const answer = getImportNameAnswer(
      merchantMappings[value] ?? '',
      Boolean(matched),
      merchantCreateNames[value],
      CREATE_MERCHANT_VALUE,
    )
    const state = getImportMerchantRowState(answer, matched)
    if (state === 'skipped') return UNKNOWN_MERCHANT_NAME
    if (state === 'matched') return matched?.name ?? source
    if (state === 'chosen') return merchantNameById.get(answer) ?? source

    // A name matching the merchant the value already matches is that merchant, however it is written
    const name = (merchantCreateNames[value] ?? value).trim()
    return matched && getNameKey(name) === getNameKey(matched.name) ? matched.name : name
  })
}
