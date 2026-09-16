import { describe, expect, it } from 'vitest'
import { getFormAfterKindChange } from '@/pages/transactions/components/transaction-modal/utils/formTransitions'
import { validateTransactionForm } from '@/pages/transactions/components/transaction-modal/utils/validation'
import type { TransactionFormValues } from '@/pages/transactions/components/transaction-modal/types'

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
    const result = getFormAfterKindChange({
      ...expenseForm,
      kind: 'transfer',
      direction: 'credit',
      category_id: 'transfer',
      counterparty_account_id: 'savings',
      symmetric_transfer: true,
    }, 'expense')

    expect(result).toMatchObject({
      kind: 'expense',
      direction: 'debit',
      category_id: '',
      counterparty_account_id: '',
      symmetric_transfer: false,
    })
  })

  it('clears the category when changing from Income to Transfer', () => {
    expect(getFormAfterKindChange({
      ...expenseForm,
      kind: 'income',
      direction: 'credit',
      category_id: 'salary',
    }, 'transfer')).toMatchObject({
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
})
