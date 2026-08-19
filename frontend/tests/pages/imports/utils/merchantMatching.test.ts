/**
 * Tests what the merchant step sends for each payee value in a file: only the values answered
 * differently from what the commit would do without being asked
 */
import { describe, expect, it } from 'vitest'
import type { Merchant } from '@/api/merchants'
import { CREATE_MERCHANT_VALUE, SKIP_MERCHANT_VALUE } from '@/pages/imports/constants'
import { buildImportMerchantMappings, getImportedMerchants, getImportMerchantRowState } from '@/pages/imports/utils'
import type { CsvRow, ImportFileDraft } from '@/pages/imports/types'

const CORNER_CAFE: Merchant = {
  id: 'corner-cafe',
  owner_id: 'user-1',
  group_id: null,
  name: 'Corner Cafe',
  is_system: false,
  default_category_id: null,
  created_at: '2026-01-01T00:00:00Z',
}

const BAKERY: Merchant = { ...CORNER_CAFE, id: 'bakery', name: 'Bakery' }

/**
 * Builds the answers for one payee value, with nothing else in the file
 */
function buildFor(value: string, answer: string, createName?: string, matched?: Merchant) {
  return buildImportMerchantMappings({
    importedMerchants: [value],
    matchedMerchantByKey: matched ? new Map([[value.trim().toLowerCase(), matched]]) : new Map(),
    merchantMappings: answer ? { [value]: answer } : {},
    merchantCreateNames: createName === undefined ? {} : { [value]: createName },
  })
}

describe('what the merchant step sends', () => {
  it('sends nothing for a value left alone', () => {
    expect(buildFor('SQ *COFFEE 4471', '').mappings).toEqual([])
  })

  it('sends nothing for a value answered with the merchant it already matched', () => {
    expect(buildFor('CORNER CAFE', CORNER_CAFE.id, undefined, CORNER_CAFE).mappings).toEqual([])
  })

  it('sends nothing for a value answered create under its own spelling', () => {
    // Creating a merchant named after the value is what the commit does unasked, so saying it
    // again would spend one of the thousand mappings an import may carry on nothing
    expect(buildFor('SQ *COFFEE 4471', CREATE_MERCHANT_VALUE, 'SQ *COFFEE 4471').mappings).toEqual([])
  })

  it('sends a create for a value answered create under a corrected name', () => {
    expect(buildFor('SQ *COFFEE 4471', CREATE_MERCHANT_VALUE, 'Coffee Bar').mappings).toEqual([
      { source: 'SQ *COFFEE 4471', create: { name: 'Coffee Bar' } },
    ])
  })

  it('sends a create for a value answered create although it matched a merchant', () => {
    // The commit would have reused Corner Cafe, so this has to say otherwise
    expect(buildFor('CORNER CAFE', CREATE_MERCHANT_VALUE, 'CORNER CAFE', CORNER_CAFE).mappings).toEqual([
      { source: 'CORNER CAFE', create: { name: 'CORNER CAFE' } },
    ])
  })

  it('sends the merchant chosen for a value that matched a different one', () => {
    expect(buildFor('CORNER CAFE', BAKERY.id, undefined, CORNER_CAFE).mappings).toEqual([
      { source: 'CORNER CAFE', merchant_id: BAKERY.id },
    ])
  })

  it('sends a skip for a value answered skip', () => {
    expect(buildFor('SQ *COFFEE 4471', SKIP_MERCHANT_VALUE).mappings).toEqual([
      { source: 'SQ *COFFEE 4471', skip: true },
    ])
  })

  it('refuses a value being created under a blank name', () => {
    const { mappings, errors } = buildFor('SQ *COFFEE 4471', CREATE_MERCHANT_VALUE, '   ')

    expect(mappings).toEqual([])
    expect(errors).toEqual(['Choose a name for the new merchant: SQ *COFFEE 4471'])
  })

  it('sends nothing at all for a file of values nobody touched', () => {
    const values = Array.from({ length: 1200 }, (_, index) => `SQ *COFFEE ${index}`)

    // A mapping per value would be refused, since an import declares at most a thousand
    expect(buildImportMerchantMappings({
      importedMerchants: values,
      matchedMerchantByKey: new Map(),
      merchantMappings: {},
      merchantCreateNames: {},
    }).mappings).toEqual([])
  })
})

describe('what one row of the merchant step reads as', () => {
  it('reads as matched where the value already has a merchant and nobody answered', () => {
    expect(getImportMerchantRowState('', CORNER_CAFE)).toBe('matched')
  })

  it('reads as creating where nothing matched and nobody answered', () => {
    expect(getImportMerchantRowState('', undefined)).toBe('creating')
  })

  it('reads as skipped where the user answered skip', () => {
    expect(getImportMerchantRowState(SKIP_MERCHANT_VALUE, CORNER_CAFE)).toBe('skipped')
  })
})

describe('the payee values a file offers to answer', () => {
  it('asks about two spellings of one payee once', () => {
    const rows: CsvRow[] = [{ Merchant: 'Amazon' }, { Merchant: 'AMAZON' }, { Merchant: 'Bakery' }]
    const file: ImportFileDraft = {
      id: 'file-1',
      name: 'Chequing.csv',
      size: 128,
      headers: ['Merchant'],
      hasHeaderRow: true,
      rows,
      error: null,
    }

    // Two rows would let one spelling be answered create and the other skip, with nothing to say
    // which answer the rows carrying either spelling take
    expect(getImportedMerchants([file], 'Merchant')).toEqual(['Amazon', 'Bakery'])
  })
})
