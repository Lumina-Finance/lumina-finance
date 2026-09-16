import { describe, expect, it } from 'vitest'
import {
  getCategorySelectionTransition,
  isModalBalanceAdjustmentCategory,
} from '@/pages/transactions/components/transaction-modal/utils/categoryTransitions'
import { getFormAfterKindChange } from '@/pages/transactions/components/transaction-modal/utils/formTransitions'
import { buildCreateTransactionPayload } from '@/pages/transactions/components/transaction-modal/utils/payloads'
import { validateTransactionForm } from '@/pages/transactions/components/transaction-modal/utils/validation'
import type { TransactionFormValues } from '@/pages/transactions/components/transaction-modal/types'
import { createCategory } from './fixtures'

const personalAdjustment = createCategory({
  id: 'personal-adjustment',
  kind: 'transfer',
  name: 'Balance Adjustment',
  is_system: false,
})

const armedTransfer: TransactionFormValues = {
  kind: 'transfer',
  direction: 'debit',
  account_id: 'checking',
  category_id: 'transfer',
  merchant_id: 'shop',
  amount: '25.00',
  currency: 'CAD',
  notes: '',
  date: '2026-09-14',
  tag_ids: [],
  symmetric_transfer: true,
  counterparty_account_id: 'savings',
}

describe('transaction category transitions', () => {
  it('classifies an exact personal transfer Balance Adjustment', () => {
    expect(isModalBalanceAdjustmentCategory(personalAdjustment)).toBe(true)
  })

  it('keeps the exact system transfer Balance Adjustment classification', () => {
    expect(isModalBalanceAdjustmentCategory(createCategory({
      kind: 'transfer', name: 'Balance Adjustment', is_system: true,
    }))).toBe(true)
  })

  it.each([
    createCategory({ kind: 'transfer', name: 'balance adjustment', is_system: false }),
    createCategory({ kind: 'expense', name: 'Balance Adjustment', is_system: true }),
    createCategory({ kind: 'income', name: 'Balance Adjustment', is_system: true }),
    createCategory({ kind: 'expense', name: 'Balance Adjustment', is_system: false }),
    createCategory({ kind: 'income', name: 'Balance Adjustment', is_system: false }),
  ])('does not classify a case or kind mismatch named $name of kind $kind', (category) => {
    expect(isModalBalanceAdjustmentCategory(category)).toBe(false)
  })

  it('clears a personal adjustment counterparty and pair before validation and payload creation', () => {
    const transition = getCategorySelectionTransition(
      personalAdjustment,
      personalAdjustment.id,
      armedTransfer.kind,
    )
    const result = getFormAfterKindChange(armedTransfer, transition.nextKind, transition.fields)

    expect(result).toMatchObject({
      category_id: personalAdjustment.id,
      counterparty_account_id: '',
      symmetric_transfer: false,
    })
    expect(validateTransactionForm(result, {
      isBalanceAdjustmentCategory: isModalBalanceAdjustmentCategory(personalAdjustment),
    }).counterparty_account_id).toBeUndefined()
    expect(buildCreateTransactionPayload(result, 2)).toEqual({
      account_id: 'checking',
      dt: '2026-09-14',
      category_id: personalAdjustment.id,
      merchant_id: 'shop',
      amount: -2500,
      currency: 'CAD',
      notes: null,
      counterparty_account_id: null,
      counterparty_account_scope: null,
    })
  })

  it('keeps regular personal transfers subject to a new counterparty answer', () => {
    const regularTransfer = createCategory({ id: 'regular-transfer', kind: 'transfer', name: 'Transfer' })
    const transition = getCategorySelectionTransition(regularTransfer, regularTransfer.id, armedTransfer.kind)
    const result = getFormAfterKindChange(armedTransfer, transition.nextKind, transition.fields)

    expect(result).toMatchObject({ counterparty_account_id: 'savings', symmetric_transfer: true })
    expect(validateTransactionForm({
      ...result,
      counterparty_account_id: '',
      symmetric_transfer: false,
    }).counterparty_account_id).toBe('Select where the money went')
  })

  it('does not restore discarded transfer references after leaving an adjustment', () => {
    const adjustment = getCategorySelectionTransition(personalAdjustment, personalAdjustment.id, armedTransfer.kind)
    const cleared = getFormAfterKindChange(armedTransfer, adjustment.nextKind, adjustment.fields)
    const regularTransfer = createCategory({ id: 'regular-transfer', kind: 'transfer', name: 'Transfer' })
    const regular = getCategorySelectionTransition(regularTransfer, regularTransfer.id, cleared.kind)

    expect(getFormAfterKindChange(cleared, regular.nextKind, regular.fields)).toMatchObject({
      counterparty_account_id: '',
      symmetric_transfer: false,
    })
  })
})
