import { useMemo, useState } from 'react'
import type { OfxFormat, OfxReadingScan, OfxStagedFile } from '@/pages/imports/ofx/types'
import { settleOfxReadings } from '@/pages/imports/ofx/utils/readingChoices'
import type { ImportAmountFormat, ImportDateFormat } from '@/pages/imports/utils'

/** What the files step shows of how dates and amounts are read, for a format that lets the user choose */
export interface OfxReadingChoices {
  scan: OfxReadingScan
  dateFormat: ImportDateFormat | null
  amountFormat: ImportAmountFormat | null

  /** Whether the reading in force was detected, rather than chosen by the user */
  isDateAutomatic: boolean
  isAmountAutomatic: boolean

  /** Whether several readings fit and none is in force, which blocks the import until the user chooses */
  isDateRequired: boolean
  isAmountRequired: boolean
  onDateFormatChange: (format: ImportDateFormat) => void
  onAmountFormatChange: (format: ImportAmountFormat) => void
}

/**
 * Settles how the staged files' dates and amounts are read, for a format that states them in no fixed
 * shape: the one reading every value fits, or the user's choice where several fit
 *
 * One reading serves all the files, as one layout serves all the CSV files of an import. The choice
 * starts over when the files do. Nothing is chosen for the user: while several readings fit and none
 * is chosen, `error` says so and the import cannot go on
 *
 * @returns The files with their dates and amounts read, the message that blocks the import or null,
 *   what the files step shows, and the way to forget the user's choices. For a format that states
 *   its values exactly, the files as they are and no choices
 */
export function useOfxReadingChoices(format: OfxFormat, stagedFiles: OfxStagedFile[], timeZone?: string) {
  const { reading } = format
  const [chosenDateFormat, setChosenDateFormat] = useState<ImportDateFormat | null>(null)
  const [chosenAmountFormat, setChosenAmountFormat] = useState<ImportAmountFormat | null>(null)

  const scan = useMemo(
    () =>
      reading?.scan(
        stagedFiles.map(({ file }) => file),
        timeZone,
      ) ?? null,
    [reading, stagedFiles, timeZone],
  )
  const settled = scan
    ? settleOfxReadings(scan, { dateFormat: chosenDateFormat, amountFormat: chosenAmountFormat })
    : null
  const dateFormat = settled?.dateFormat ?? null
  const amountFormat = settled?.amountFormat ?? null
  const isDateRequired = settled?.isDateRequired ?? false
  const isAmountRequired = settled?.isAmountRequired ?? false

  const files = useMemo(
    () =>
      stagedFiles.map(({ file }) => (reading ? reading.resolve(file, { dateFormat, amountFormat }, timeZone) : file)),
    [amountFormat, dateFormat, reading, stagedFiles, timeZone],
  )

  const error = !reading
    ? null
    : isDateRequired
      ? reading.dateRequiredError
      : isAmountRequired
        ? reading.amountRequiredError
        : null
  const choices: OfxReadingChoices | null =
    scan && settled
      ? {
          scan,
          dateFormat,
          amountFormat,
          isDateAutomatic: settled.isDateAutomatic,
          isAmountAutomatic: settled.isAmountAutomatic,
          isDateRequired,
          isAmountRequired,
          onDateFormatChange: setChosenDateFormat,
          onAmountFormatChange: setChosenAmountFormat,
        }
      : null

  const reset = () => {
    setChosenDateFormat(null)
    setChosenAmountFormat(null)
  }

  return { files, error, choices, reset }
}
