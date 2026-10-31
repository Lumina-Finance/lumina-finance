/**
 * Covers the words the export dialogue uses to say what the file will hold, since a file that holds
 * more or less than the wording says leaves the person trusting the wrong thing
 */
import { describe, expect, it } from 'vitest'
import { describeExport, type ExportNames } from '@/components/transactions/export/describeExport'
import { formatDateLabel, formatDateRangeLabel } from '@/utils/date'

const NAMES: ExportNames = {
  accounts: new Map([
    ['acc_1', 'Everyday'],
    ['acc_2', 'Savings'],
  ]),
  categories: new Map([
    ['cat_1', 'Groceries'],
    ['cat_2', 'Food, drink'],
  ]),
  merchants: new Map([['mer_1', 'Costco']]),
  tags: new Map([
    ['tag_1', 'trip'],
    ['tag_2', 'work'],
  ]),
}

const formatAmount = (minorUnits: number, currency: string) => `${currency} ${(minorUnits / 100).toFixed(2)}`

function describeWith(filters: Parameters<typeof describeExport>[0]['filters'], search = '') {
  return describeExport({ filters, search, names: NAMES, formatAmount })
}

describe('describeExport', () => {
  it('names the date range as the only filter, matching the Filters button that counts it', () => {
    const description = describeWith({ from_date: '2031-10-01', to_date: '2031-10-31' })

    expect(description?.summary).toBe(
      `The file will hold all your transactions dated ${formatDateRangeLabel('2031-10-01', '2031-10-31')}. No search or other filters are applied.`,
    )
    expect(description?.groups).toEqual([])
  })

  it('names every applied condition by its human name, never an id', () => {
    const description = describeWith(
      {
        from_date: '2031-10-01',
        to_date: '2031-10-31',
        account_id: ['acc_1', 'acc_2'],
        category_id: ['cat_2'],
        merchant_id: ['mer_1'],
        tag_id: ['tag_1', 'tag_2'],
        tag_match: 'any',
        currency: 'CAD',
        min_amount: 500,
        max_amount: 9000,
        amount_currency: 'CAD',
      },
      '  dinner ',
    )

    expect(description?.summary).toBe(
      `The file will hold your transactions dated ${formatDateRangeLabel('2031-10-01', '2031-10-31')} that match everything below.`,
    )
    expect(description?.groups).toEqual([
      { label: 'Merchant or notes containing', values: ['dinner'] },
      { label: 'Accounts', values: ['Everyday', 'Savings'] },
      { label: 'Category', values: ['Food, drink'] },
      { label: 'Merchant', values: ['Costco'] },
      { label: 'Tags, any one of them', values: ['trip', 'work'] },
      { label: 'Currency', values: ['CAD'] },
      { label: 'Amount', values: ['between CAD 5.00 and CAD 90.00 CAD'] },
    ])
  })

  it('says whether every tag or just one is needed', () => {
    const everyTag = describeWith({ tag_id: ['tag_1', 'tag_2'], tag_match: 'all' })
    const oneTag = describeWith({ tag_id: ['tag_1'], tag_match: 'all' })

    expect(everyTag?.groups[0].label).toBe('Tags, all of them')
    expect(oneTag?.groups[0].label).toBe('Tag')
  })

  it.each([
    [{ min_amount: 500 }, 'at least CAD 5.00 CAD'],
    [{ max_amount: 9000 }, 'at most CAD 90.00 CAD'],
  ])('describes a one-sided amount range %j', (bounds, expected) => {
    const description = describeWith({ ...bounds, amount_currency: 'CAD' })

    expect(description?.groups).toEqual([{ label: 'Amount', values: [expected] }])
  })

  it('describes a date range open at one end or both', () => {
    expect(describeWith({ from_date: '2031-10-01' })?.summary).toContain(
      `dated ${formatDateLabel('2031-10-01')} or later`,
    )
    expect(describeWith({ to_date: '2031-10-31' })?.summary).toContain(
      `dated ${formatDateLabel('2031-10-31')} or earlier`,
    )
    expect(describeWith({})?.summary).toBe(
      'The file will hold all your transactions, whatever their date. No search or filters are applied.',
    )
  })

  it('says every date, and no filters, for the dialogue a page with no date filter opens', () => {
    expect(describeWith({})?.summary).toBe(
      'The file will hold all your transactions, whatever their date. No search or filters are applied.',
    )
    expect(describeWith({ category_id: ['cat_1'] })?.summary).toBe(
      'The file will hold your transactions that match everything below, whatever their date.',
    )
  })

  it('counts a search alone as a condition', () => {
    const description = describeWith({ from_date: '2031-10-01', to_date: '2031-10-31' }, 'rent')

    expect(description?.groups).toEqual([{ label: 'Merchant or notes containing', values: ['rent'] }])
    expect(description?.summary).toContain('that match everything below')
  })

  it('waits rather than show an id when a chosen name is not known yet', () => {
    expect(describeWith({ merchant_id: ['mer_unknown'] })).toBeNull()
    expect(describeWith({ account_id: ['acc_1', 'acc_unknown'] })).toBeNull()
  })
})
