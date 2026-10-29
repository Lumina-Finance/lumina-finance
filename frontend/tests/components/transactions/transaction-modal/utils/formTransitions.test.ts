/**
 * Covers what a change of kind does to the rest of the form: the category and transfer references
 * it clears or keeps, the fields it leaves alone, and the direction it resets, or keeps for a bank item
 *
 * These tests catch a category left that the new kind can't take, a transfer reference left on an
 * expense, an unrelated field cleared, and a bank item's money in turned into money out by a switch to
 * Transfer
 */
import { describe, expect, it } from 'vitest'
import { getFormAfterKindChange } from '@/components/transactions/transaction-modal/utils/formTransitions'
import { validateTransactionForm } from '@/components/transactions/transaction-modal/utils/validation'
import type { TransactionFormValues } from '@/components/transactions/transaction-modal/types'

const expenseForm: TransactionFormValues = {
  kind: 'expense',
  direction: 'debit',
  account_id: 'checking',
  category_id: 'groceries',
  merchant_id: 'shop',
  amount: '50.00',
  currency: 'CAD',
  notes: 'keep me',
  date: '2026-09-14',
  tag_ids: ['receipt'],
  symmetric_transfer: false,
  counterparty_account_id: '',
}

describe('transaction kind transitions', () => {
  it('clears an incompatible category while preserving unrelated fields', () => {
    const result = getFormAfterKindChange(expenseForm, 'transfer')

    expect(result).toEqual({
      ...expenseForm,
      kind: 'transfer',
      direction: 'debit',
      category_id: '',
    })
    expect(validateTransactionForm(result).category_id).toBe('Select a category')
  })

  it('clears the category and transfer references when changing from Transfer to Expense', () => {
    const result = getFormAfterKindChange(
      {
        ...expenseForm,
        kind: 'transfer',
        direction: 'credit',
        category_id: 'transfer',
        counterparty_account_id: 'savings',
        symmetric_transfer: true,
      },
      'expense',
    )

    expect(result).toMatchObject({
      kind: 'expense',
      direction: 'debit',
      category_id: '',
      counterparty_account_id: '',
      symmetric_transfer: false,
    })
  })

  it('clears the category when changing from Income to Transfer', () => {
    expect(
      getFormAfterKindChange(
        {
          ...expenseForm,
          kind: 'income',
          direction: 'credit',
          category_id: 'salary',
        },
        'transfer',
      ),
    ).toMatchObject({
      kind: 'transfer',
      direction: 'debit',
      category_id: '',
      counterparty_account_id: '',
      symmetric_transfer: false,
    })
  })

  it('preserves a same-kind transfer and an explicit replacement category', () => {
    const transferForm: TransactionFormValues = {
      ...expenseForm,
      kind: 'transfer',
      direction: 'credit',
      category_id: 'transfer',
      counterparty_account_id: 'savings',
      symmetric_transfer: true,
    }

    expect(getFormAfterKindChange(transferForm, 'transfer')).toEqual(transferForm)
    expect(getFormAfterKindChange(transferForm, 'income', { category_id: 'salary' })).toMatchObject({
      kind: 'income',
      direction: 'credit',
      category_id: 'salary',
      counterparty_account_id: '',
      symmetric_transfer: false,
    })
  })

  it('does not reset direction when the same transition is applied again', () => {
    const first = getFormAfterKindChange(expenseForm, 'transfer', { category_id: 'transfer' })
    const withCreditDirection = { ...first, direction: 'credit' as const }

    expect(getFormAfterKindChange(withCreditDirection, 'transfer')).toEqual(withCreditDirection)
  })

  it("keeps a bank item's direction, the bank's record of which way the money went, through a kind change", () => {
    const moneyIn = { ...expenseForm, kind: 'income' as const, direction: 'credit' as const, category_id: 'salary' }

    expect(getFormAfterKindChange(moneyIn, 'transfer', {}, true)).toEqual({
      ...moneyIn,
      kind: 'transfer',
      category_id: '',
    })
    expect(getFormAfterKindChange(moneyIn, 'transfer').direction).toBe('debit')
  })
})
