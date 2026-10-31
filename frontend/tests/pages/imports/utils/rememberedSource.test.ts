/**
 * Tests which Data source an account's import page opens on, so a source the page can't import into
 * the account, or no saved source at all, opens on CSV instead of a flow that doesn't fit
 */
import { describe, expect, it } from 'vitest'
import type { SavedAccountImportSource } from '@/api/transaction-imports'
import { getRememberedDataSource } from '@/pages/imports/utils'
import { ACCOUNT_DATA_SOURCES } from '@/pages/imports/utils/rememberedSource'

const SAVED: SavedAccountImportSource[] = [
  { account_id: 'checking', source: 'ofx' },
  { account_id: 'quicken', source: 'qif' },
  { account_id: 'savings', source: 'generic' },
  { account_id: 'brokerage', source: 'firefly' },
  { account_id: 'budgeting', source: 'actual_budget' },
]

describe('getRememberedDataSource', () => {
  it('opens on the OFX/QFX source last imported into the account', () => {
    expect(getRememberedDataSource(SAVED, 'checking')).toBe('ofx')
  })

  it('opens on the Quicken 3.0 (QIF) source last imported into the account', () => {
    expect(getRememberedDataSource(SAVED, 'quicken')).toBe('qif')
  })

  it('offers QIF on an account page, so the source it remembers is one the page lists', () => {
    expect(ACCOUNT_DATA_SOURCES).toEqual(['generic', 'ofx', 'qif'])
  })

  it('opens on CSV for an account last imported into from a CSV file', () => {
    expect(getRememberedDataSource(SAVED, 'savings')).toBe('generic')
  })

  it('opens on CSV for an account with no earlier import', () => {
    expect(getRememberedDataSource(SAVED, 'never-imported')).toBe('generic')
  })

  it.each(['brokerage', 'budgeting'])(
    'opens on CSV when %s was last imported into from a source the page does not offer',
    (accountId) => {
      expect(getRememberedDataSource(SAVED, accountId)).toBe('generic')
    },
  )

  it('opens on CSV when the saved sources could not be loaded', () => {
    expect(getRememberedDataSource(undefined, 'checking')).toBe('generic')
  })
})
