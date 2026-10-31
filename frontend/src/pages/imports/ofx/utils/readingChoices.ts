import type { OfxReadingScan } from '@/pages/imports/ofx/types'
import type { ImportAmountFormat, ImportDateFormat } from '@/pages/imports/utils'

/** The readings the user has picked, each null until they pick one */
export interface ChosenOfxReadings {
  dateFormat: ImportDateFormat | null
  amountFormat: ImportAmountFormat | null
}

/**
 * Settles which reading of the dates and of the amounts is in force for a scan of the staged files
 *
 * A choice always wins, and keeps winning as files are added, since it was made for the files as a
 * whole. Without one the reading every value fits is used, and where several fit none is used and
 * the reading is required, so the import waits for the user
 */
export function settleOfxReadings(scan: OfxReadingScan, chosen: ChosenOfxReadings) {
  const dateFormat = chosen.dateFormat ?? scan.date.automatic
  const amountFormat = chosen.amountFormat ?? scan.amount.automatic

  return {
    dateFormat,
    amountFormat,

    // Whether the reading was detected rather than chosen
    isDateAutomatic: chosen.dateFormat === null,
    isAmountAutomatic: chosen.amountFormat === null,
    isDateRequired: dateFormat === null && scan.date.ambiguous,
    isAmountRequired: amountFormat === null && scan.amount.ambiguous,
  }
}
