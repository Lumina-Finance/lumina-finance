/**
 * Tests transaction form validation, so the required fields and the counterparty-account answer a
 * transfer has to carry cannot drift from the category it is recorded under
 *
 * The required-fields case also builds a payload, since what validation lets through is only worth
 * anything if the payload built from it is the one the API expects
 */
import { describe, expect, it } from 'vitest'
import { buildCreateTransactionPayload } from '@/components/transactions/transaction-modal/utils/payloads'
import {
  getTransactionProblems,
  validateTransactionForm,
} from '@/components/transactions/transaction-modal/utils/validation'
import { createAccount } from './fixtures'

describe('transaction form validation', () => {
  it('validates required fields and positive amounts before creating payloads', () => {
    expect(
      validateTransactionForm({
        kind: 'expense',
        direction: 'debit',
        account_id: '',
        category_id: '',
        merchant_id: '',
        amount: '0',
        currency: '',
        notes: '',
        date: '',
        tag_ids: [],
        symmetric_transfer: false,
        counterparty_account_id: '',
      }),
    ).toEqual({
      account_id: 'Select an account',
      category_id: 'Select a category',
      merchant_id: 'Select or create a merchant',
      amount: 'Amount must be greater than zero',
      currency: 'Select a currency',
      date: 'Select a date',
    })

    expect(
      buildCreateTransactionPayload(
        {
          kind: 'expense',
          direction: 'debit',
          account_id: 'checking',
          category_id: 'groceries',
          merchant_id: 'store',
          amount: '123.45',
          currency: 'CAD',
          notes: ' Weekly groceries ',
          date: '2026-06-11',
          tag_ids: ['tax'],
          symmetric_transfer: false,
          counterparty_account_id: '',
        },
        2,
      ),
    ).toEqual({
      account_id: 'checking',
      dt: '2026-06-11',
      category_id: 'groceries',
      merchant_id: 'store',
      amount: -12345,
      currency: 'CAD',
      notes: 'Weekly groceries',
      tag_ids: ['tax'],
    })
  })

  it('requires a counterparty-account answer on every transfer that is not Balance Adjustment', () => {
    const transferForm = {
      kind: 'transfer' as const,
      direction: 'debit' as const,
      account_id: 'checking',
      category_id: 'transfer-out',
      merchant_id: 'store',
      amount: '50.00',
      currency: 'CAD',
      notes: '',
      date: '2026-06-11',
      tag_ids: [],
      symmetric_transfer: false,
      counterparty_account_id: '',
    }

    // A transfer with no answer fails validation, on an edit as much as on a create, which is what
    // brings transactions recorded before the field existed onto the new footing
    expect(validateTransactionForm(transferForm).counterparty_account_id).toBe('Select where the money went')

    // Balance Adjustment has no counterparty, so it is never required
    expect(
      validateTransactionForm(transferForm, { isBalanceAdjustmentCategory: true }).counterparty_account_id,
    ).toBeUndefined()

    // Ticking the checkbox makes this field the receiving account, so it is the one field asked
    // for either way rather than a second one appearing beside it
    const symmetricForm = { ...transferForm, symmetric_transfer: true }
    expect(validateTransactionForm(symmetricForm).counterparty_account_id).toBe('Select where the money went')

    // Answering it once the checkbox is ticked clears the requirement, same as the standalone case
    expect(
      validateTransactionForm({ ...symmetricForm, counterparty_account_id: 'savings' }).counterparty_account_id,
    ).toBeUndefined()

    // Picking the transaction's own account as the counterparty is always rejected
    expect(
      validateTransactionForm({ ...transferForm, counterparty_account_id: 'checking' }).counterparty_account_id,
    ).toBe('Choose a different account')
  })
})

describe('refund limit', () => {
  const refundForm = {
    kind: 'expense' as const,
    direction: 'credit' as const,
    account_id: 'account',
    category_id: 'groceries',
    merchant_id: 'store',
    amount: '25.01',
    currency: 'CAD',
    notes: '',
    date: '2026-06-11',
    tag_ids: [],
    symmetric_transfer: false,
    counterparty_account_id: '',
  }
  const refundLimit = { minor: 2500, currency: 'CAD', exponent: 2, message: 'Only $25.00 is left to refund' }

  it('refuses an amount past what is left to refund and accepts one that fills it', () => {
    expect(validateTransactionForm(refundForm, { refundLimit }).amount).toBe('Only $25.00 is left to refund')
    expect(validateTransactionForm({ ...refundForm, amount: '25.00' }, { refundLimit }).amount).toBeUndefined()
  })

  it('leaves an amount in another currency alone, since it cannot be compared', () => {
    expect(validateTransactionForm({ ...refundForm, currency: 'USD' }, { refundLimit }).amount).toBeUndefined()
  })
})

describe('transaction problems', () => {
  const pairForm = {
    kind: 'transfer' as const,
    direction: 'debit' as const,
    account_id: 'from',
    category_id: 'transfer-out',
    merchant_id: 'store',
    amount: '50.00',
    currency: 'CAD',
    notes: '',
    date: '2026-06-11',
    tag_ids: [],
    symmetric_transfer: true,
    counterparty_account_id: 'to',
  }
  const from = createAccount({ id: 'from', currency: 'CAD' })

  it('marks the receiving account of a new pair that cannot hold the same amount', () => {
    expect(
      getTransactionProblems(pairForm, {
        editing: false,
        selectedAccount: from,
        selectedCounterpartyAccount: createAccount({ id: 'to', currency: 'JPY' }),
      }),
    ).toEqual({ counterparty_account_id: 'Both accounts must use the same currency' })
  })

  it('leaves a pair of matching accounts and an edit of a recorded one unmarked', () => {
    expect(
      getTransactionProblems(pairForm, {
        editing: false,
        selectedAccount: from,
        selectedCounterpartyAccount: createAccount({ id: 'to', currency: 'CAD' }),
      }),
    ).toEqual({})
    expect(
      getTransactionProblems(pairForm, {
        editing: true,
        selectedAccount: from,
        selectedCounterpartyAccount: createAccount({ id: 'to', currency: 'JPY' }),
      }),
    ).toEqual({})
  })
})
