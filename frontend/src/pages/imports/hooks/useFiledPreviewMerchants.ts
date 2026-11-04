import { useMemo } from 'react'
import type { PreviewTransactionRow } from '@/pages/imports/types'
import { fileRowsUnderMatchedMerchants } from '@/pages/imports/utils'
import { useImportMerchantMatches } from './useImportMerchantMatches'

/**
 * Shows a provider import's preview rows under the merchants the commit will file them under
 *
 * These imports have no merchant step, so the commit matches each name to a merchant the user
 * already has, whatever capitals it is written in. Only the sample's names are asked about, so
 * the question stays small whatever the size of the file. A row reads as the file spells it until
 * the answer arrives
 *
 * @param rows - The preview rows, in import order
 */
export function useFiledPreviewMerchants(rows: PreviewTransactionRow[]) {
  const names = useMemo(() => [...new Set(rows.flatMap((row) => row.transaction.merchant_name ?? []))].sort(), [rows])
  const { matchedMerchantByKey } = useImportMerchantMatches(names)

  return useMemo(() => fileRowsUnderMatchedMerchants(rows, matchedMerchantByKey), [matchedMerchantByKey, rows])
}
