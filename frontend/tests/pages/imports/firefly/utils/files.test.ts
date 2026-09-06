/**
 * Tests Firefly III file validation through the real CSV reader so header detection cannot silently
 * turn an export's first row into data or discard it
 */
import { describe, expect, it } from 'vitest'
import {
  FIREFLY_BUDGETS_REQUIRED_HEADERS,
  FIREFLY_TRANSACTIONS_REQUIRED_HEADERS,
} from '@/pages/imports/firefly/constants'
import { readFireflyCsvFile } from '@/pages/imports/firefly/utils/files'

const SUPPORTED_CURRENCY_CODES = new Set(['CAD', 'USD'])

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
