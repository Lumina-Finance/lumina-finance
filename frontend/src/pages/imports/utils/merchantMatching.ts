import { getMerchantNameKey } from '@/api/shared/merchantNameKey'
import type { Merchant } from '@/api/merchants'
import type { TransactionImportMerchantMapping } from '@/api/transaction-imports'
import type { DropdownOption } from '@/components/dropdown/Dropdown'
import {
  CREATE_MERCHANT_VALUE,
  SKIP_MERCHANT_VALUE,
  UNKNOWN_MERCHANT_NAME,
} from '@/pages/imports/constants'

/**
 * Builds the answers the merchant step offers for one payee value
 *
 * The merchants offered are the ones the file's own values already match, plus whatever a search
 * turned up, since a person can have thousands and the page never holds them all
 *
 * @param merchants - Merchants to offer, from the file's matches and from the current search
 */
export function buildImportMerchantOptions(merchants: Merchant[]): DropdownOption[] {
  const byId = new Map(merchants.map((merchant) => [merchant.id, merchant]))

  return [
    { value: CREATE_MERCHANT_VALUE, label: 'Create new merchant', group: 'Import action' },
    {
      value: SKIP_MERCHANT_VALUE,
      label: `Skip, filing rows under ${UNKNOWN_MERCHANT_NAME}`,
      group: 'Import action',
    },
    ...[...byId.values()]
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((merchant) => ({
        value: merchant.id,
        label: merchant.name,
        group: 'Existing merchants',
      })),
  ]
}

/**
 * What one payee value resolves to once the file's matches and the user's answer are both read
 *
 * @param answer - What the user chose for it, blank where they left it alone
 * @param matched - The merchant the value already matches, if any
 */
export function getImportMerchantRowState(answer: string, matched: Merchant | undefined) {
  if (answer === SKIP_MERCHANT_VALUE) return 'skipped' as const
  if (answer === CREATE_MERCHANT_VALUE) return 'creating' as const
  if (answer) return 'chosen' as const
  return matched ? 'matched' as const : 'creating' as const
}

/**
 * Builds the payee answers the commit payload carries
 *
 * Only a value answered differently from what the commit would do unasked is sent, so a file
 * carrying thousands of distinct descriptors nobody touched declares none of them and is not
 * refused for declaring more than an import may carry
 *
 * @param importedMerchants - One payee value per merchant the file resolves to
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
  const mappings: TransactionImportMerchantMapping[] = []
  const errors: string[] = []

  for (const value of importedMerchants) {
    const answer = merchantMappings[value] ?? ''
    if (!answer) continue

    const key = getMerchantNameKey(value)
    const matched = matchedMerchantByKey.get(key)

    if (answer === SKIP_MERCHANT_VALUE) {
      mappings.push({ source: value, skip: true })
      continue
    }

    if (answer === CREATE_MERCHANT_VALUE) {
      const name = (merchantCreateNames[value] ?? value).trim()
      if (!name) {
        errors.push(`Name the merchant being created for: ${value}`)
        continue
      }

      // Left out where it says nothing the commit would not do anyway, which is creating a merchant
      // under the value's own spelling when nothing matches it
      if (matched || getMerchantNameKey(name) !== key) mappings.push({ source: value, create: { name } })
      continue
    }

    // Left out where the chosen merchant is the one the value already matches
    if (!matched || matched.id !== answer) mappings.push({ source: value, merchant_id: answer })
  }

  return { mappings, errors }
}
