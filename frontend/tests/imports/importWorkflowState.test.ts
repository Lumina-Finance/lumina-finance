/**
 * Tests import workflow state helpers so column target changes keep validation, auto-fill markers, and completion checks consistent
 */
import { describe, expect, it } from 'vitest'
import { EMPTY_COLUMN_MAP } from '@/imports/constants'
import type { ImportFileDraft } from '@/imports/types'
import {
  getNextAutoFilledColumnHeaders,
  getNextColumnMap,
  getNextColumnValidationErrors,
  isColumnMappingComplete,
} from '@/imports/utils'

/**
 * Creates an import file fixture for column completion checks
 */
function createFile(): ImportFileDraft {
  return {
    id: 'file',
    name: 'Checking.csv',
    size: 1024,
    headers: ['Date', 'Amount', 'Category'],
    hasHeaderRow: true,
    rows: [{ Date: '2026-06-01', Amount: '10.00', Category: 'Food' }],
    error: null,
  }
}

describe('import workflow state helpers', () => {
  it('moves a header to the selected target and clears the old target', () => {
    const next = getNextColumnMap({
      ...EMPTY_COLUMN_MAP,
      dt: 'Date',
      notes: 'Amount',
    }, 'Amount', 'amount')

    expect(next.amount).toBe('Amount')
    expect(next.notes).toBe('')
  })

  it('tracks only auto-filled headers that remain mapped', () => {
    const previous = {
      ...EMPTY_COLUMN_MAP,
      dt: 'Date',
      amount: 'Amount',
    }
    const next = {
      ...previous,
      amount: 'Total',
    }

    expect([...getNextAutoFilledColumnHeaders(new Set(['Amount', 'Removed']), previous, next)]).toEqual(['Total'])
  })

  it('updates validation errors for cleared, displaced, valid, and invalid target assignments', () => {
    expect(getNextColumnValidationErrors({ Amount: 'Bad amount' }, 'Amount', '', '', {
      valid: true,
      message: '',
    })).toEqual({})

    expect(getNextColumnValidationErrors({ Old: 'Bad date' }, 'Amount', 'Old', 'amount', {
      valid: false,
      message: 'Bad amount',
    })).toEqual({ Amount: 'Bad amount' })

    expect(getNextColumnValidationErrors({ Amount: 'Bad amount' }, 'Amount', '', 'amount', {
      valid: true,
      message: '',
    })).toEqual({})
  })

  it('requires mapped columns to pass validation before the mapping is complete', () => {
    const completeMap = {
      ...EMPTY_COLUMN_MAP,
      dt: 'Date',
      amount: 'Amount',
      category_id: 'Category',
    }

    expect(isColumnMappingComplete(completeMap, {}, [createFile()])).toBe(true)
    expect(isColumnMappingComplete(completeMap, { Amount: 'Bad amount' }, [createFile()])).toBe(false)
    expect(isColumnMappingComplete({ ...completeMap, amount: '' }, {}, [createFile()])).toBe(false)
    expect(isColumnMappingComplete(completeMap, {}, [])).toBe(false)
  })
})
