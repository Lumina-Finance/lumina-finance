/**
 * Tests the counterparty-account dropdown, so which accounts a transfer can name cannot drift from the
 * account holding it, whether the pair checkbox is ticked, and which accounts are archived
 */
import { describe, expect, it } from 'vitest'
import { OUTSIDE_ACCOUNT_VALUE } from '@/utils/transfers'
import { buildCounterpartyAccountOptions } from '@/pages/transactions/components/transaction-modal/utils/options'
import { createAccount } from './fixtures'

describe('counterparty-account options', () => {
  const accounts = [
    createAccount({ id: 'checking', name: 'Chequing' }),
    createAccount({ id: 'savings', name: 'Savings' }),
  ]

  it('offers the outside entry first and leaves out the account holding the transfer', () => {
    const options = buildCounterpartyAccountOptions(accounts, 'checking', false)

    expect(options.map((option) => option.value)).toEqual([OUTSIDE_ACCOUNT_VALUE, 'savings'])
  })

  it('drops the outside entry once the pair checkbox is ticked, since a transaction is written there', () => {
    const options = buildCounterpartyAccountOptions(accounts, 'checking', true)

    expect(options.map((option) => option.value)).toEqual(['savings'])
  })

  it('offers no way back to unanswered, since every edit has to answer', () => {
    const options = buildCounterpartyAccountOptions(accounts, 'checking', false)

    expect(options.some((option) => option.value === '')).toBe(false)
  })

  it('leaves out an archived account, which takes no new transactions anywhere else either', () => {
    const withArchived = [...accounts, createAccount({ id: 'old-tfsa', name: 'Old TFSA', is_archived: true })]

    const options = buildCounterpartyAccountOptions(withArchived, 'checking', false)

    expect(options.map((option) => option.value)).toEqual([OUTSIDE_ACCOUNT_VALUE, 'savings'])
  })

  it('leaves it out with the pair checkbox ticked as well', () => {
    const withArchived = [...accounts, createAccount({ id: 'old-tfsa', name: 'Old TFSA', is_archived: true })]

    const options = buildCounterpartyAccountOptions(withArchived, 'checking', true)

    expect(options.map((option) => option.value)).toEqual(['savings'])
  })
})
