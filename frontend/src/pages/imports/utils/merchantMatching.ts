import type { Merchant } from '@/api/merchants'
import type { TransactionImportMerchantMapping } from '@/api/transaction-imports'
import type { DropdownOption } from '@/components/dropdown/Dropdown'
import { CREATE_MERCHANT_VALUE, SKIP_MERCHANT_VALUE, UNKNOWN_MERCHANT_NAME } from '@/pages/imports/constants'
import { buildImportNameMappings, getImportNameRowState } from './nameMatching'

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
  })
}
