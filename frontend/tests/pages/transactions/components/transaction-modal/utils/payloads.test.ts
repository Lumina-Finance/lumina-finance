/**
 * Tests the payloads the transaction modal sends, so an edit patch carries only what changed, a
 * transfer pair writes each leg recording the other, and the counterparty selection reaches the API as
 * an id and a scope
 */
import { describe, expect, it } from 'vitest'
import { OUTSIDE_ACCOUNT_VALUE } from '@/utils/transfers'
import { buildInitialTransactionForm } from '@/pages/transactions/components/transaction-modal/utils/initialForm'
import {
  buildCreateTransactionPayload,
  buildSymmetricTransferPayloads,
  buildUpdateTransactionPatch,
  getSymmetricTransferLegKinds,
} from '@/pages/transactions/components/transaction-modal/utils/payloads'
import { createAccount, createCategory, createTransaction, currencies } from './fixtures'

describe('transaction modal payloads', () => {
  it('builds minimal edit patches and returns null when the transaction is unchanged', () => {
    const transaction = createTransaction({
      tag_ids: ['tax', 'business'],
      tags: [
        { id: 'tax', group_id: null, name: 'Tax' },
        { id: 'business', group_id: null, name: 'Business' },
      ],
    })
    const unchangedForm = buildInitialTransactionForm({
      transaction,
      categories: [createCategory({ id: 'groceries' })],
      currencies,
      selectableAccounts: [createAccount({ id: 'checking' })],
      timeZone: undefined,
    })

    expect(buildUpdateTransactionPatch(unchangedForm, transaction, 2)).toBeNull()
    expect(buildUpdateTransactionPatch({
      ...unchangedForm,
      amount: '200.00',
      direction: 'credit',
      tag_ids: ['business'],
    }, transaction, 2)).toEqual({
      amount: 20000,
      tag_ids: ['business'],
    })
  })

  it('writes the pair into the one chosen account, each leg recording the other', () => {
    const baseForm = {
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
      symmetric_transfer: true,
      counterparty_account_id: 'savings',
    }

    // The one account field is both what the pair is written to and what each leg records, so the
    // two can no longer disagree
    const [fromPayload, toPayload] = buildSymmetricTransferPayloads(baseForm, 2)
    expect(fromPayload).toMatchObject({
      account_id: 'checking',
      amount: -5000,
      counterparty_account_id: 'savings',
      counterparty_account_scope: 'tracked',
    })
    expect(toPayload).toMatchObject({
      account_id: 'savings',
      amount: 5000,
      counterparty_account_id: 'checking',
      counterparty_account_scope: 'tracked',
    })

    // The direction says what happens to the account above, so on a credit the money arrives there
    // and leaves the other, rather than the recorded account always being the one debited
    const [creditFrom, creditTo] = buildSymmetricTransferPayloads(
      { ...baseForm, direction: 'credit' as const },
      2,
    )
    expect(creditFrom).toMatchObject({ account_id: 'checking', amount: 5000 })
    expect(creditTo).toMatchObject({ account_id: 'savings', amount: -5000 })
  })

  it('splits the counterparty-account selection into an id-and-scope pair for create and update payloads', () => {
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
      counterparty_account_id: OUTSIDE_ACCOUNT_VALUE,
    }

    expect(buildCreateTransactionPayload(transferForm, 2)).toMatchObject({
      counterparty_account_id: null,
      counterparty_account_scope: 'outside',
    })
    expect(buildCreateTransactionPayload({ ...transferForm, counterparty_account_id: 'savings' }, 2)).toMatchObject({
      counterparty_account_id: 'savings',
      counterparty_account_scope: 'tracked',
    })

    const transaction = createTransaction({
      category_id: 'transfer-out',
      counterparty_account_id: 'savings',
      counterparty_account_scope: 'tracked',
    })
    const unchangedForm = buildInitialTransactionForm({
      transaction,
      categories: [createCategory({ id: 'transfer-out', kind: 'transfer' })],
      currencies,
      selectableAccounts: [createAccount({ id: 'checking' })],
      timeZone: undefined,
    })

    // Untouched, so no patch at all
    expect(buildUpdateTransactionPatch(unchangedForm, transaction, 2)).toBeNull()

    // Recording a different account sends the new pair
    expect(buildUpdateTransactionPatch(
      { ...unchangedForm, counterparty_account_id: 'joint-savings' },
      transaction,
      2,
    )).toMatchObject({ counterparty_account_id: 'joint-savings', counterparty_account_scope: 'tracked' })

    // Clearing the field back to unanswered sends nulls rather than omitting them
    expect(buildUpdateTransactionPatch(
      { ...unchangedForm, counterparty_account_id: '' },
      transaction,
      2,
    )).toMatchObject({ counterparty_account_id: null, counterparty_account_scope: null })

    // Moving to a non-transfer category leaves the pair out entirely, since the backend clears it itself
    expect(buildUpdateTransactionPatch(
      { ...unchangedForm, kind: 'expense', category_id: 'groceries' },
      transaction,
      2,
    )).toEqual({ category_id: 'groceries' })
  })
})

describe('symmetric transfer leg kinds', () => {
  it('gives the recorded account the direction and the other leg its opposite', () => {
    expect(getSymmetricTransferLegKinds('debit')).toEqual(['debit', 'credit'])
    expect(getSymmetricTransferLegKinds('credit')).toEqual(['credit', 'debit'])
  })

  it('agrees with the signs the payloads carry, so a failed leg is described as it was built', () => {
    const form = {
      kind: 'transfer' as const,
      direction: 'credit' as const,
      account_id: 'checking',
      category_id: 'transfer-out',
      merchant_id: 'store',
      amount: '50.00',
      currency: 'CAD',
      notes: '',
      date: '2026-06-11',
      tag_ids: [],
      symmetric_transfer: true,
      counterparty_account_id: 'savings',
    }

    const [recordedKind, otherKind] = getSymmetricTransferLegKinds(form.direction)
    const [recordedPayload, otherPayload] = buildSymmetricTransferPayloads(form, 2)

    expect(recordedKind === 'debit').toBe(recordedPayload.amount < 0)
    expect(otherKind === 'debit').toBe(otherPayload.amount < 0)
  })
})
