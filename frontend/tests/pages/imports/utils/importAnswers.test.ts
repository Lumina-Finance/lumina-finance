/**
 * Tests when a CSV import's answers count as changed, which decides whether an upload kept from an
 * interrupted save can still be saved or has to be sent again with the new answers
 */
import { describe, expect, it } from 'vitest'
import { EMPTY_COLUMN_MAP } from '@/pages/imports/constants'
import { keepUnchangedImportAnswers, WHOLE_FILE_DATE_RANGE, type CsvImportAnswers } from '@/pages/imports/utils'

const ANSWERS: CsvImportAnswers = {
  files: [],
  storedColumnMap: EMPTY_COLUMN_MAP,
  fixedAccountId: null,
  scopedAccountMappings: {},
  accountCreateTypes: {},
  accountCreateCurrencies: {},
  accountCreateInstitutions: {},
  dateFormatChoice: { scope: '', chosen: null },
  dateRange: WHOLE_FILE_DATE_RANGE,
  amountFormatChoice: { scope: '', chosen: null },
  scopedDirectionAnswers: {},
  scopedCategoryMappings: {},
  scopedCategoryCreateKinds: {},
  scopedCategoryCreateNames: {},
  scopedMerchantMappings: {},
  scopedMerchantCreateNames: {},
  scopedTagMappings: {},
  scopedTagCreateNames: {},
}

describe('telling whether the answers changed', () => {
  it('keeps the same answers while every part is the same', () => {
    expect(keepUnchangedImportAnswers(ANSWERS, { ...ANSWERS })).toBe(ANSWERS)
  })

  // Otherwise a save interrupted and then retried after the dates changed would write the rows the
  // first dates chose
  it('takes new answers once the chosen dates change', () => {
    const next = { ...ANSWERS, dateRange: { from: '2025-03-01', to: '' } }

    expect(keepUnchangedImportAnswers(ANSWERS, next)).toBe(next)
  })
})
