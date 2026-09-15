/**
 * Tests Firefly III file validation through the real CSV reader so header detection cannot silently
 * turn an export's first row into data or discard it
 */
import { describe, expect, it, vi } from 'vitest'
import {
  FIREFLY_BUDGETS_REQUIRED_HEADERS,
  FIREFLY_TRANSACTIONS_REQUIRED_HEADERS,
} from '@/pages/imports/firefly/constants'
import { readFireflyCsvFile } from '@/pages/imports/firefly/utils/files'
import { processImportFileIntake } from '@/pages/imports/utils'

const SUPPORTED_CURRENCY_CODES = new Set(['CAD', 'USD'])
const TRANSACTIONS_CSV = `${FIREFLY_TRANSACTIONS_REQUIRED_HEADERS.join(',')}\n1,withdrawal,-12.34,CAD,2026-04-11,Main Chequing,Asset account,Corner Grocer,Expense account\n`
const BUDGETS_CSV = `${FIREFLY_BUDGETS_REQUIRED_HEADERS.join(',')}\n`

function readFile(csv: string, kind: 'transactions' | 'budgets') {
  return readFireflyCsvFile(new File([csv], `${kind}.csv`), kind, SUPPORTED_CURRENCY_CODES)
}

describe('reading Firefly III export files', () => {
  it('accepts a transactions export carrying every required header', async () => {
    const headers = FIREFLY_TRANSACTIONS_REQUIRED_HEADERS.join(',')
    const row = '1,withdrawal,-12.34,CAD,2026-04-11,Main Chequing,Asset account,Corner Grocer,Expense account'

    const draft = await readFile(`${headers}\n${row}\n`, 'transactions')

    expect(draft.error).toBeNull()
    expect(draft.hasHeaderRow).toBe(true)
    expect(draft.rows).toHaveLength(1)
    expect(draft.rows[0].amount).toBe('-12.34')
  })

  it('reports a missing required transactions header', async () => {
    const headers = FIREFLY_TRANSACTIONS_REQUIRED_HEADERS.filter((header) => header !== 'destination_type')
    const row = '1,withdrawal,-12.34,CAD,2026-04-11,Main Chequing,Asset account,Corner Grocer'

    const draft = await readFile(`${headers.join(',')}\n${row}\n`, 'transactions')

    expect(draft.error).toContain('missing columns: destination_type')
  })

  it('accepts a budgets export with only its required headers', async () => {
    const draft = await readFile(`${FIREFLY_BUDGETS_REQUIRED_HEADERS.join(',')}\n`, 'budgets')

    expect(draft.error).toBeNull()
    expect(draft.hasHeaderRow).toBe(true)
    expect(draft.rows).toHaveLength(0)
  })
})

describe('delegating selected Firefly files to their supplied slot', () => {
  it('passes a transactions CSV to the transactions reader', async () => {
    const file = new File([TRANSACTIONS_CSV], 'transactions.csv', { type: 'text/csv' })
    const readFile = vi.fn((selectedFile: File) => (
      readFireflyCsvFile(selectedFile, 'transactions', SUPPORTED_CURRENCY_CODES)
    ))

    const result = await processImportFileIntake({
      files: [file],
      processing: false,
      unavailableReason: null,
      readFile,
    })

    expect(readFile).toHaveBeenCalledWith(file)
    expect(result.status).toBe('accepted')
    if (result.status !== 'accepted') return
    expect(result.result.error).toBeNull()
    expect(result.result.rows).toHaveLength(1)
  })

  it('passes a budgets CSV to the budgets reader', async () => {
    const file = new File([BUDGETS_CSV], 'budgets.csv', { type: 'text/csv' })
    const readFile = vi.fn((selectedFile: File) => (
      readFireflyCsvFile(selectedFile, 'budgets', SUPPORTED_CURRENCY_CODES)
    ))

    const result = await processImportFileIntake({
      files: [file],
      processing: false,
      unavailableReason: null,
      readFile,
    })

    expect(readFile).toHaveBeenCalledWith(file)
    expect(result.status).toBe('accepted')
    if (result.status !== 'accepted') return
    expect(result.result.error).toBeNull()
    expect(result.result.rows).toEqual([])
  })

  it('keeps the supplied slot authoritative over file contents', async () => {
    const file = new File([TRANSACTIONS_CSV], 'transactions.csv', { type: 'text/csv' })

    const result = await processImportFileIntake({
      files: [file],
      processing: false,
      unavailableReason: null,
      readFile: (selectedFile) => readFireflyCsvFile(selectedFile, 'budgets', SUPPORTED_CURRENCY_CODES),
    })

    expect(result.status).toBe('accepted')
    if (result.status !== 'accepted') return
    expect(result.result.error).toContain('missing columns: name, active, start_date')
  })

  it('refuses a non-CSV file before invoking the Firefly reader', async () => {
    const file = new File([TRANSACTIONS_CSV], 'image.png', { type: 'image/png' })
    const readFile = vi.fn((selectedFile: File) => (
      readFireflyCsvFile(selectedFile, 'transactions', SUPPORTED_CURRENCY_CODES)
    ))

    expect(await processImportFileIntake({
      files: [file],
      processing: false,
      unavailableReason: null,
      readFile,
    })).toEqual({ status: 'refused', reason: 'Choose a CSV file.' })
    expect(readFile).not.toHaveBeenCalled()
  })

  it('refuses multiple files before invoking either slot reader', async () => {
    const first = new File([TRANSACTIONS_CSV], 'first.csv', { type: 'text/csv' })
    const second = new File([TRANSACTIONS_CSV], 'second.csv', { type: 'text/csv' })
    const readFile = vi.fn((selectedFile: File) => (
      readFireflyCsvFile(selectedFile, 'transactions', SUPPORTED_CURRENCY_CODES)
    ))

    expect(await processImportFileIntake({
      files: [first, second],
      processing: false,
      unavailableReason: null,
      readFile,
    })).toEqual({ status: 'refused', reason: 'Choose one CSV file at a time.' })
    expect(readFile).not.toHaveBeenCalled()
  })
})
