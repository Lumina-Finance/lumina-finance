/**
 * Tests which reading of the staged files' dates and amounts is in force: the one every value fits,
 * the user's choice where several fit, and none while several fit and nothing is chosen. The choice
 * must survive more files being added, and a file added later must be able to make a reading
 * ambiguous that the files before it settled
 */
import { describe, expect, it } from 'vitest'
import { settleOfxReadings } from '@/pages/imports/ofx/utils/readingChoices'
import { readQifFile } from '@/pages/imports/qif/utils/readFile'
import { scanQifReadings } from '@/pages/imports/qif/utils/readings'

const NONE_CHOSEN = { dateFormat: null, amountFormat: null }
const COMMA_DECIMAL = { decimalSeparator: ',', groupingSeparator: '.' } as const

/** One QIF file holding a transaction for each date and amount pair */
function qif(...pairs: [date: string, amount: string][]) {
  return ['!Type:Bank', ...pairs.flatMap(([date, amount]) => [`D${date}`, `T${amount}`, '^'])].join('\n')
}

/** Scans QIF files as the import does once they are staged together */
async function scanFiles(...contents: string[]) {
  const files = await Promise.all(
    contents.map(async (text, position) => {
      const read = await readQifFile(new File([text], `file-${position}.qif`), `file-${position}`)
      if (read.status !== 'read') throw new Error(read.reason)
      return read.file
    }),
  )
  return scanQifReadings(files)
}

describe('settleOfxReadings', () => {
  it('takes the reading every value fits and calls it detected', async () => {
    const scan = await scanFiles(qif(['1/25/2024', '12.50']))

    expect(settleOfxReadings(scan, NONE_CHOSEN)).toMatchObject({
      dateFormat: 'monthFirst',
      isDateAutomatic: true,
      isDateRequired: false,
      isAmountRequired: false,
    })
  })

  it('requires a choice while several readings fit and none is chosen', async () => {
    const scan = await scanFiles(qif(['1/2/2024', '1,234']))

    expect(settleOfxReadings(scan, NONE_CHOSEN)).toMatchObject({
      dateFormat: null,
      amountFormat: null,
      isDateRequired: true,
      isAmountRequired: true,
    })
  })

  it('puts the choice in force and marks it as chosen', async () => {
    const scan = await scanFiles(qif(['1/2/2024', '1,234']))

    expect(settleOfxReadings(scan, { dateFormat: 'dayFirst', amountFormat: COMMA_DECIMAL })).toMatchObject({
      dateFormat: 'dayFirst',
      amountFormat: COMMA_DECIMAL,
      isDateAutomatic: false,
      isAmountAutomatic: false,
      isDateRequired: false,
      isAmountRequired: false,
    })
  })

  it('keeps a choice when another file is added and the readings still fit more than one way', async () => {
    const chosen = { dateFormat: 'dayFirst', amountFormat: COMMA_DECIMAL } as const
    const first = await scanFiles(qif(['1/2/2024', '1,234']))
    const withSecond = await scanFiles(qif(['1/2/2024', '1,234']), qif(['3/4/2024', '5,678']))

    expect(settleOfxReadings(first, chosen)).toMatchObject({ dateFormat: 'dayFirst', amountFormat: COMMA_DECIMAL })
    expect(settleOfxReadings(withSecond, chosen)).toMatchObject({
      dateFormat: 'dayFirst',
      amountFormat: COMMA_DECIMAL,
      isDateRequired: false,
      isAmountRequired: false,
    })
  })

  it('requires a choice once a later file makes a settled reading ambiguous', async () => {
    const settled = await scanFiles(qif(['1/25/2024', '5']))
    const withLater = await scanFiles(qif(['1/25/2024', '5']), qif(['1/26/2024', '1,234']))

    expect(settleOfxReadings(settled, NONE_CHOSEN)).toMatchObject({ isAmountAutomatic: true, isAmountRequired: false })
    expect(settleOfxReadings(settled, NONE_CHOSEN).amountFormat).not.toBeNull()
    expect(settleOfxReadings(withLater, NONE_CHOSEN)).toMatchObject({
      amountFormat: null,
      isAmountRequired: true,
      isDateRequired: false,
    })
  })

  it('starts over with the detected reading when the choice is cleared', async () => {
    const scan = await scanFiles(qif(['1/2/2024', '1'], ['3/4/2024', '1']))

    expect(settleOfxReadings(scan, { dateFormat: 'dayFirst', amountFormat: null }).dateFormat).toBe('dayFirst')
    expect(settleOfxReadings(scan, NONE_CHOSEN)).toMatchObject({ dateFormat: null, isDateRequired: true })
  })
})
