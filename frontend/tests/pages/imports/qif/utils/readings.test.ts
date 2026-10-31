/**
 * Tests the date and amount readings of QIF files: a date or amount that fits more than one reading
 * is left for the person to choose and never guessed, and no amount is changed to make a transaction
 * fit, so a transaction whose own values disagree is skipped with the reason
 */
import { describe, expect, it } from 'vitest'
import { QIF_AMOUNTS_DIFFER_REASON, QIF_TWO_DIGIT_YEAR_REASON } from '@/pages/imports/qif/constants'
import { normalizeQifDate, resolveQifFile, scanQifReadings } from '@/pages/imports/qif/utils/readings'
import type { OfxReadings } from '@/pages/imports/ofx/types'
import { buildQifFile } from './fixtures'

const US_READINGS: OfxReadings = {
  dateFormat: 'monthFirst',
  amountFormat: { decimalSeparator: '.', groupingSeparator: ',' },
}

function resolve(transactions: Parameters<typeof buildQifFile>[0], readings: OfxReadings = US_READINGS) {
  return resolveQifFile(buildQifFile(transactions), readings).statements[0].transactions
}

describe('normalizeQifDate', () => {
  it.each([
    ['1/2/2024', '1/2/2024'],
    ['01/02/2024', '01/02/2024'],
    ["1/2'24", '1/2/2024'],
    ["6/ 1'05", '6/1/2005'],
    ['6/ 1/1994', '6/1/1994'],
    ['01/02/24', '01/02/24'],
    ['2024-01-02', '2024-01-02'],
  ])('rewrites %s as %s', (text, expected) => {
    expect(normalizeQifDate(text)).toBe(expected)
  })
})

describe('resolveQifFile dates', () => {
  it.each([
    ['1/2/2024', 'monthFirst', '2024-01-02'],
    ['1/2/2024', 'dayFirst', '2024-02-01'],
    ['01/02/2024', 'monthFirst', '2024-01-02'],
    ["1/2'24", 'monthFirst', '2024-01-02'],
    ["1/2'24", 'dayFirst', '2024-02-01'],
  ] as const)('reads %s in %s order as %s', (postedText, dateFormat, expected) => {
    const [transaction] = resolve([{ postedText }], { ...US_READINGS, dateFormat })
    expect(transaction.date).toBe(expected)
  })

  it('skips a two-digit year after a slash with the reason instead of guessing the century', () => {
    const [transaction] = resolve([{ postedText: '01/02/24' }])

    expect(transaction.date).toBeNull()
    expect(transaction.readProblem).toBe(QIF_TWO_DIGIT_YEAR_REASON)
  })

  it('leaves the date null while no reading is chosen', () => {
    const [transaction] = resolve([{}], { ...US_READINGS, dateFormat: null })
    expect(transaction.date).toBeNull()
  })

  it('leaves a missing or impossible date null', () => {
    const transactions = resolve([{ postedText: '' }, { postedText: '13/45/2024' }])
    expect(transactions.map(({ date }) => date)).toEqual([null, null])
  })
})

describe('scanQifReadings dates', () => {
  it('finds both orders readable when every date could be either', () => {
    const scan = scanQifReadings([buildQifFile([{ postedText: '1/2/2024' }, { postedText: '3/4/2024' }])])

    expect(scan.date.ambiguous).toBe(true)
    expect(scan.date.automatic).toBeNull()
    expect(scan.date.readable).toEqual(expect.arrayContaining(['monthFirst', 'dayFirst']))
  })

  it('settles the order when one date can only be read one way', () => {
    const scan = scanQifReadings([buildQifFile([{ postedText: '1/2/2024' }, { postedText: '1/25/2024' }])])

    expect(scan.date.ambiguous).toBe(false)
    expect(scan.date.automatic).toBe('monthFirst')
  })

  it('settles the order across the staged files together', () => {
    const scan = scanQifReadings([
      buildQifFile([{ postedText: '1/2/2024' }]),
      buildQifFile([{ postedText: '25/2/2024' }]),
    ])

    expect(scan.date.automatic).toBe('dayFirst')
  })

  it('reads apostrophe years in the scan', () => {
    const scan = scanQifReadings([buildQifFile([{ postedText: "1/25'24" }])])
    expect(scan.date.automatic).toBe('monthFirst')
  })
})

describe('resolveQifFile amounts', () => {
  it.each([
    ['-1,234.50', '-1234.50'],
    ['1,234,567.89', '1234567.89'],
    ['+5.00', '5.00'],
    ['0.5', '0.5'],
    ['-12', '-12'],
  ])('reads %s as %s', (amountText, expected) => {
    expect(resolve([{ amountText }])[0].amount).toBe(expected)
  })

  it('reads the same text another way when the person chooses the other format', () => {
    const european = { decimalSeparator: ',', groupingSeparator: '.' } as const
    expect(resolve([{ amountText: '1.234,50' }], { ...US_READINGS, amountFormat: european })[0].amount).toBe('1234.50')
  })

  it('leaves the amount null while no reading is chosen or when none reads it', () => {
    expect(resolve([{}], { ...US_READINGS, amountFormat: null })[0].amount).toBeNull()
    expect(resolve([{ amountText: 'abc' }, { amountText: '' }]).map(({ amount }) => amount)).toEqual([null, null])
  })

  it('finds a thousands amount ambiguous rather than reading 1,234 as one number', () => {
    const scan = scanQifReadings([buildQifFile([{ amountText: '1,234' }])])

    expect(scan.amount.ambiguous).toBe(true)
    expect(scan.amount.automatic).toBeNull()
  })

  it('settles the format when an amount can only be read one way', () => {
    const scan = scanQifReadings([buildQifFile([{ amountText: '1,234' }, { amountText: '12.50' }])])

    expect(scan.amount.ambiguous).toBe(false)
    expect(scan.amount.automatic).toEqual({ decimalSeparator: '.', groupingSeparator: ',' })
  })

  it('scans the U line and the split lines along with the T line', () => {
    const scan = scanQifReadings([
      buildQifFile([{ amountText: '1,234', alternateAmountText: '1,234', splitAmountTexts: ['1,000', '234.50'] }]),
    ])

    expect(scan.amount.automatic).toEqual({ decimalSeparator: '.', groupingSeparator: ',' })
  })
})

describe('resolveQifFile amounts that disagree', () => {
  it('keeps the amount when T and U agree, even when written differently', () => {
    const [transaction] = resolve([{ amountText: '1,234.50', alternateAmountText: '1234.5' }])

    expect(transaction.amount).toBe('1234.50')
    expect(transaction.readProblem).toBeNull()
  })

  it('skips a transaction whose T and U differ and changes neither', () => {
    const [transaction] = resolve([{ amountText: '10.00', alternateAmountText: '11.00' }])

    expect(transaction.amount).toBe('10.00')
    expect(transaction.readProblem).toBe(QIF_AMOUNTS_DIFFER_REASON)
  })

  it('skips a transaction whose U cannot be read', () => {
    const [transaction] = resolve([{ amountText: '10.00', alternateAmountText: 'x' }])
    expect(transaction.readProblem).toBe(QIF_AMOUNTS_DIFFER_REASON)
  })
})

describe('resolveQifFile splits', () => {
  it('accepts splits that add up to the total exactly', () => {
    const [transaction] = resolve([{ amountText: '-100.10', splitAmountTexts: ['-60.05', '-40.05'] }])
    expect(transaction.readProblem).toBeNull()
  })

  it('compares in decimal digits, so 0.1 and 0.2 make 0.3', () => {
    const [transaction] = resolve([{ amountText: '0.3', splitAmountTexts: ['0.1', '0.2'] }])
    expect(transaction.readProblem).toBeNull()
  })

  it('skips splits that fall a cent short, with the total in the reason', () => {
    const [transaction] = resolve([{ amountText: '-100.00', splitAmountTexts: ['-60.00', '-39.99'] }])

    expect(transaction.readProblem).toContain('-100.00')
    expect(transaction.amount).toBe('-100.00')
  })

  it('skips a transaction with a split amount that is not a number', () => {
    const [transaction] = resolve([{ amountText: '-100.00', splitAmountTexts: ['-60.00', ''] }])
    expect(transaction.readProblem).toBeTruthy()
  })

  it('scans and adds up half a million split lines without a call stack error', () => {
    const splitAmountTexts = Array.from({ length: 500_000 }, () => '1')
    const file = buildQifFile([{ amountText: '500000', splitAmountTexts }])

    expect(scanQifReadings([file]).amount.automatic).not.toBeNull()
    const [transaction] = resolveQifFile(file, US_READINGS).statements[0].transactions
    expect(transaction.amount).toBe('500000')
    expect(transaction.readProblem).toBeNull()
  })

  it('has no problem for a transaction with no splits', () => {
    expect(resolve([{}])[0].readProblem).toBeNull()
  })
})
