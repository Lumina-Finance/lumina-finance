import { describe, expect, it } from 'vitest'
import { buildCategoryTransactionsUrl, parseTransactionNavigationFilters, writeTransactionNavigationFilters } from '@/pages/transactions/utils/filterNavigation'

const FIRST = '12345678-1234-1234-1234-123456789abc'
const SECOND = 'abcdefab-1234-5678-9012-abcdefabcdef'

describe('transaction navigation filters', () => {
  it('reads repeated categories, deduplicating case-insensitively and ignoring malformed IDs', () => {
    expect(parseTransactionNavigationFilters(new URLSearchParams(`category_id=${FIRST}&category_id=${FIRST.toUpperCase()}&category_id=invalid&category_id=${SECOND}`))).toEqual({ category_id: [FIRST, SECOND] })
  })

  it.each(['2024-02-29', '2000-02-29', '2024-04-30', '0001-01-01'])('accepts the real calendar day %s', (date) => {
    expect(parseTransactionNavigationFilters(new URLSearchParams({ from_date: date, to_date: date }))).toEqual({ from_date: date, to_date: date })
  })

  it.each(['2023-02-29', '1900-02-29', '2024-04-31', '2024-13-01', '2024-01-00', '0000-01-01', '2024-2-03', '2024-01-01T00:00:00Z', 'junk'])('omits malformed calendar bound %s independently', (date) => {
    expect(parseTransactionNavigationFilters(new URLSearchParams({ from_date: date, to_date: '2024-03-01' }))).toEqual({ to_date: '2024-03-01' })
  })

  it('drops both reversed valid bounds while retaining a category', () => {
    expect(parseTransactionNavigationFilters(new URLSearchParams({ category_id: FIRST, from_date: '2024-04-01', to_date: '2024-03-01' }))).toEqual({ category_id: [FIRST] })
  })

  it('round-trips owned fields while preserving unrelated repeated query values', () => {
    const original = new URLSearchParams(`context=one&context=two&category_id=${SECOND}&from_date=invalid&other=keep`)
    const filters = { category_id: [FIRST, SECOND], from_date: '2024-03-01', to_date: '2024-03-31' }
    const written = writeTransactionNavigationFilters(original, filters)
    expect(parseTransactionNavigationFilters(written)).toEqual(filters)
    expect(written.getAll('context')).toEqual(['one', 'two'])
    expect(written.get('other')).toBe('keep')
    expect(original.get('from_date')).toBe('invalid')
    expect(Array.from(writeTransactionNavigationFilters(written, {}))).toEqual([['context', 'one'], ['context', 'two'], ['other', 'keep']])
  })

  it('validates values written from a complete filter state', () => {
    expect(Array.from(writeTransactionNavigationFilters(new URLSearchParams(), { category_id: ['junk', FIRST, FIRST], from_date: '2024-04-01', to_date: '2024-03-01' }))).toEqual([['category_id', FIRST]])
  })

  it('builds only category and inclusive date filters without a sign restriction', () => {
    expect(buildCategoryTransactionsUrl(FIRST, { from: '2024-03-01', to: '2024-03-31' })).toBe(`/transactions?category_id=${FIRST}&from_date=2024-03-01&to_date=2024-03-31`)
  })
})
