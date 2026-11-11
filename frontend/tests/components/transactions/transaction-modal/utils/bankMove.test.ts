/**
 * Guards the account a bank-imported transaction can't leave while it stays linked, so the account
 * field refuses the move before a save, while manual transactions and bank ones whose account has
 * since been unlinked move freely
 */
import { describe, expect, it } from 'vitest'
import { getBankMoveRefusal } from '@/components/transactions/transaction-modal/utils/bankMove'
import { BANK_SOURCE, createAccount, createTransaction } from './fixtures'

const EVERYDAY = createAccount({ id: 'everyday', name: 'Everyday' })
const SAVINGS = createAccount({ id: 'savings', name: 'Savings' })
const LINKS = new Map([[EVERYDAY.id, { provider_name: 'SimpleFIN' }]])
const MOVE_REFUSAL = 'Transactions from SimpleFIN stay in Everyday while the account is linked'

describe('moving a bank-imported transaction out of its linked account', () => {
  it('refuses the move, naming the account it would leave', () => {
    const refusal = getBankMoveRefusal({
      accountId: SAVINGS.id,
      transaction: createTransaction({ account_id: EVERYDAY.id, bank_source: BANK_SOURCE }),
      sourceAccount: EVERYDAY,
      linksByAccount: LINKS,
    })

    expect(refusal).toBe(MOVE_REFUSAL)
  })

  it.each([
    ['it stays in its account', EVERYDAY.id, EVERYDAY.id, BANK_SOURCE],
    ['its account is no longer linked', SAVINGS.id, EVERYDAY.id, BANK_SOURCE],
    ['it was entered by hand', EVERYDAY.id, SAVINGS.id, null],
  ])('lets it through when %s', (_, from, to, bankSource) => {
    const refusal = getBankMoveRefusal({
      accountId: to,
      transaction: createTransaction({ account_id: from, bank_source: bankSource }),
      sourceAccount: from === EVERYDAY.id ? EVERYDAY : SAVINGS,
      linksByAccount: LINKS,
    })

    expect(refusal).toBeNull()
  })

  it('leaves a new transaction alone', () => {
    expect(getBankMoveRefusal({ accountId: SAVINGS.id, sourceAccount: undefined, linksByAccount: LINKS })).toBeNull()
  })
})
