/**
 * Tests the steer shown when Debt Payment is chosen, so the line cannot start appearing for a
 * category it was never meant for, and the offered switch cannot point at a category that is not
 * the system one or be offered where the transaction cannot be changed
 */
import { describe, expect, it } from 'vitest'
import { getCreditRepaymentSteer } from '@/pages/transactions/components/transaction-modal/utils/creditRepayment'
import { createCategory } from './fixtures'

const debtPayment = createCategory({ id: 'debt-payment', name: 'Debt Payment', is_system: true })
const creditCardPayment = createCategory({
  id: 'credit-card-payment',
  name: 'Credit Card Payment',
  kind: 'transfer',
  is_system: true,
})
const everyCategory = [debtPayment, creditCardPayment]

describe('credit repayment steer', () => {
  it('shows the line and offers the system Credit Card Payment category', () => {
    expect(getCreditRepaymentSteer(debtPayment, everyCategory, false))
      .toEqual({ show: true, switchTargetId: 'credit-card-payment' })
  })

  it('offers no switch on a transaction that cannot be changed', () => {
    expect(getCreditRepaymentSteer(debtPayment, everyCategory, true))
      .toEqual({ show: true, switchTargetId: null })
  })

  it('still shows the line when Credit Card Payment has not loaded yet', () => {
    expect(getCreditRepaymentSteer(debtPayment, [debtPayment], false))
      .toEqual({ show: true, switchTargetId: null })
  })

  it('ignores a personal category sharing either name', () => {
    const personalDebtPayment = createCategory({ id: 'mine', name: 'Debt Payment' })
    const personalCreditCardPayment = createCategory({
      id: 'also-mine',
      name: 'Credit Card Payment',
      kind: 'transfer',
    })

    expect(getCreditRepaymentSteer(personalDebtPayment, everyCategory, false))
      .toEqual({ show: false, switchTargetId: null })
    expect(getCreditRepaymentSteer(debtPayment, [debtPayment, personalCreditCardPayment], false))
      .toEqual({ show: true, switchTargetId: null })
  })

  it('shows nothing for another system expense category', () => {
    const groceries = createCategory({ id: 'groceries', name: 'Groceries', is_system: true })

    expect(getCreditRepaymentSteer(groceries, everyCategory, false))
      .toEqual({ show: false, switchTargetId: null })
  })

  it('shows nothing while no category is chosen', () => {
    expect(getCreditRepaymentSteer(undefined, everyCategory, false))
      .toEqual({ show: false, switchTargetId: null })
  })
})
