/**
 * Guards Delete on a bank-imported transaction while its account stays linked, so the modal greys it
 * out with the reason the server refuses it with, while manual transactions and bank ones whose
 * account has since been unlinked delete as usual
 */
import { describe, expect, it } from 'vitest'
import { getBankDeleteRefusal } from '@/components/transactions/transaction-modal/utils/bankDelete'
import { BANK_SOURCE, createAccount, createTransaction } from './fixtures'

const EVERYDAY = createAccount({ id: 'everyday', name: 'Everyday' })
const SAVINGS = createAccount({ id: 'savings', name: 'Savings' })
const LINKS = new Map([[EVERYDAY.id, { provider_name: 'SimpleFIN' }]])
const DELETE_REFUSAL = 'Imported from SimpleFIN. While Everyday is linked, please edit this transaction instead'

describe('deleting a bank-imported transaction from its linked account', () => {
  it('refuses the delete, naming the provider it came from and the account', () => {
    const refusal = getBankDeleteRefusal({
      transaction: createTransaction({ account_id: EVERYDAY.id, bank_source: BANK_SOURCE }),
      sourceAccount: EVERYDAY,
      linksByAccount: LINKS,
    })

    expect(refusal).toBe(DELETE_REFUSAL)
  })

  it.each([
    ['its account is no longer linked', SAVINGS, BANK_SOURCE],
    ['it was entered by hand', EVERYDAY, null],
  ])('lets it through when %s', (_, account, bankSource) => {
    const refusal = getBankDeleteRefusal({
      transaction: createTransaction({ account_id: account.id, bank_source: bankSource }),
      sourceAccount: account,
      linksByAccount: LINKS,
    })

    expect(refusal).toBeNull()
  })

  it('leaves a new transaction alone', () => {
    expect(getBankDeleteRefusal({ transaction: undefined, sourceAccount: undefined, linksByAccount: LINKS })).toBeNull()
  })

  it('leaves the refusal to the server while its account is missing from the account list', () => {
    const refusal = getBankDeleteRefusal({
      transaction: createTransaction({ account_id: EVERYDAY.id, bank_source: BANK_SOURCE }),
      sourceAccount: undefined,
      linksByAccount: LINKS,
    })

    expect(refusal).toBeNull()
  })
})
