/**
 * Covers what a bank item's import rules fill into the review form and the lines beneath the fields
 *
 * These tests catch a rule's category turning the bank's amount around the way picking a category of
 * another kind by hand does, a line naming the wrong rule or staying after the person changed its
 * field, a category or tags the rules couldn't fill leaving the person with an empty field and no
 * reason, and a reason that says something untrue for its direction
 */
import { describe, expect, it } from 'vitest'
import type { BankReviewGivenCategory, BankReviewGivenValue, BankReviewRuleFill } from '@/api/bank-sync'
import { buildReviewItemForm } from '@/components/transactions/transaction-modal/utils/initialForm'
import { applyRuleFill, getRuleFillLines } from '@/components/transactions/transaction-modal/utils/ruleFill'
import type { TransactionFormValues } from '@/components/transactions/transaction-modal/types'
import { currencies } from './fixtures'

const PAY = { id: 'rule-pay', name: 'Pay' }
const COFFEE = { id: 'rule-coffee', name: 'Coffee' }

const given = (id: string, name: string, rule = PAY): BankReviewGivenValue => ({ id, name, rule })
const category = (kind: BankReviewGivenCategory['kind'], rule = PAY): BankReviewGivenCategory => ({
  ...given('salary', 'Salary', rule),
  kind,
})

/** A fill giving a merchant, an income category and two tags, the tags from two rules */
const FILL: BankReviewRuleFill = {
  merchant: given('acme', 'Acme'),
  category: category('income'),
  tags: [given('work', 'Work'), given('daily', 'Daily', COFFEE)],
  category_left_out: null,
  tags_left_out: null,
}
const EMPTY_FILL: BankReviewRuleFill = {
  merchant: null,
  category: null,
  tags: [],
  category_left_out: null,
  tags_left_out: null,
}

function reviewForm(amount: number, fill: BankReviewRuleFill | null): TransactionFormValues {
  return buildReviewItemForm(
    {
      account_id: 'everyday',
      bank: {
        date: '2026-09-21',
        amount,
        raw_amount: null,
        description: 'DIRECT DEP ACME',
        note: null,
        merchant: null,
      },
      rule_fill: fill,
    },
    'CAD',
    currencies,
  )
}

describe('the form a bank item opens with, filled in by its rules', () => {
  it('sets the merchant, the category and the tags, and leaves the bank amount and its direction as they were', () => {
    // A category of the other kind picked by hand would flip an expense to income. A rule's category
    // already fits the direction, so the entry stays what the bank's sign says
    expect(reviewForm(200000, FILL)).toMatchObject({
      kind: 'income',
      direction: 'credit',
      amount: '2000.00',
      merchant_id: 'acme',
      category_id: 'salary',
      tag_ids: ['work', 'daily'],
    })
    expect(
      reviewForm(-4200, { ...EMPTY_FILL, category: category('expense'), merchant: given('acme', 'Acme') }),
    ).toMatchObject({ kind: 'expense', direction: 'debit', amount: '42.00', category_id: 'salary' })
  })

  it('leaves what the rules did not give empty, and a form with no fill as it always was', () => {
    expect(reviewForm(-4200, { ...EMPTY_FILL, merchant: given('acme', 'Acme') })).toMatchObject({
      merchant_id: 'acme',
      category_id: '',
      tag_ids: [],
    })
    expect(reviewForm(-4200, null)).toMatchObject({ merchant_id: '', category_id: '', tag_ids: [] })
    expect(applyRuleFill(reviewForm(-4200, null), null)).toEqual(reviewForm(-4200, null))
  })
})

describe('the lines beneath the filled fields', () => {
  const filled = reviewForm(200000, FILL)

  it('name the rule behind each filled field, the tags naming each rule once', () => {
    expect(getRuleFillLines(FILL, filled)).toEqual({
      merchant: { tone: 'filled', text: 'Filled in by Pay' },
      category: { tone: 'filled', text: 'Filled in by Pay' },
      tags: { tone: 'filled', text: 'Filled in by Pay and Coffee' },
    })
    expect(
      getRuleFillLines({ ...FILL, tags: [given('work', 'Work'), given('daily', 'Daily')] }, filled).tags?.text,
    ).toBe('Filled in by Pay')
  })

  it('show nothing for an item no rule filled', () => {
    expect(getRuleFillLines(null, filled)).toEqual({ merchant: null, category: null, tags: null })
    expect(getRuleFillLines(EMPTY_FILL, filled)).toEqual({ merchant: null, category: null, tags: null })
  })

  it('go away from the field the person changes, and only that field', () => {
    expect(getRuleFillLines(FILL, { ...filled, merchant_id: 'other' })).toMatchObject({
      merchant: null,
      category: { text: 'Filled in by Pay' },
      tags: { text: 'Filled in by Pay and Coffee' },
    })
    expect(getRuleFillLines(FILL, { ...filled, category_id: 'other' })).toMatchObject({
      category: null,
      merchant: { text: 'Filled in by Pay' },
    })
    expect(getRuleFillLines(FILL, { ...filled, tag_ids: ['work'] }).tags).toBeNull()
    expect(getRuleFillLines(FILL, { ...filled, tag_ids: ['work', 'daily', 'mine'] }).tags).not.toBeNull()
  })
})

describe('the lines for a category or tags the rules could not fill', () => {
  const form = reviewForm(-4200, null)

  it.each([
    [
      'income_for_money_out',
      'income',
      'The rule "Pay" didn\'t fill in the category "Salary": it\'s an income category and this item is money out.',
    ],
    [
      'expense_for_money_in',
      'expense',
      'The rule "Pay" didn\'t fill in the category "Salary": it\'s an expense category and this item is money in.',
    ],
    [
      'transfer',
      'transfer',
      'The rule "Pay" didn\'t fill in the category "Salary": a rule can\'t fill in a transfer category.',
    ],
    [
      'no_direction',
      'income',
      'The rule "Pay" didn\'t fill in the category "Salary": the amount doesn\'t say if this is money in or money out.',
    ],
  ] as const)('say why a %s category was left out, naming the rule', (reason, kind, text) => {
    const fill = { ...EMPTY_FILL, category_left_out: { ...category(kind), reason } }

    expect(getRuleFillLines(fill, form).category).toEqual({ tone: 'left-out', text })
  })

  it('stop once the person has chosen a category themselves', () => {
    const fill = {
      ...EMPTY_FILL,
      category_left_out: { ...category('income'), reason: 'income_for_money_out' as const },
    }

    expect(getRuleFillLines(fill, { ...form, category_id: 'groceries' }).category).toBeNull()
  })

  it('say why no tag was filled in, naming each rule behind them', () => {
    const one = { ...EMPTY_FILL, tags_left_out: { rules: [PAY], count: 40, limit: 32, reason: 'too_many' as const } }
    const two = { ...one, tags_left_out: { ...one.tags_left_out, rules: [PAY, COFFEE] } }

    expect(getRuleFillLines(one, form).tags).toEqual({
      tone: 'left-out',
      text: 'The rule "Pay" didn\'t fill in any tags: it adds 40 tags and a transaction holds at most 32.',
    })
    expect(getRuleFillLines(two, form).tags?.text).toBe(
      'The rules "Pay" and "Coffee" didn\'t fill in any tags: they add 40 tags together and a transaction holds at most 32.',
    )
    expect(getRuleFillLines(one, { ...form, tag_ids: ['mine'] }).tags).toBeNull()
  })
})
