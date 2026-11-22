/**
 * Covers the sentence a rule's row shows for its conditions
 *
 * These tests catch a wording that says the opposite of a condition, such as a "doesn't contain" read as
 * "contains", an All joined as Any, an amount shown at the wrong scale, a group that loses its
 * brackets, and a long value filling the row
 */
import { describe, expect, it } from 'vitest'
import type { Currency } from '@/api/currency'
import type { ImportRule, ImportRuleCondition, ImportRuleItem } from '@/api/import-rules'
import { getRuleSets, getRuleSummary } from '@/pages/settings/components/import-rules-section/utils/summary'
import { formatCurrency } from '@/utils/formatCurrency'

const CURRENCIES: Currency[] = [
  { id: 'CAD', name: 'Canadian dollar', symbol: '$', minor_unit_exponent: 2 },
  { id: 'JPY', name: 'Japanese yen', symbol: '¥', minor_unit_exponent: 0 },
]

function ruleOf(conditions: ImportRuleItem[], match: ImportRule['match'] = 'all'): ImportRule {
  return {
    id: 'rule-1',
    name: 'Market',
    position: 0,
    match,
    conditions,
    merchant: null,
    category: null,
    tags: [],
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  }
}

const text = (attribute: 'description' | 'note', operator: 'contains', value: string): ImportRuleCondition => ({
  kind: 'condition',
  attribute,
  operator,
  value,
})

describe('a rule as one sentence', () => {
  it.each([
    ['contains', 'Description contains "MARKET"'],
    ['not_contains', 'Description doesn\'t contain "MARKET"'],
    ['is', 'Description is "MARKET"'],
    ['is_not', 'Description isn\'t "MARKET"'],
    ['starts_with', 'Description starts with "MARKET"'],
    ['ends_with', 'Description ends with "MARKET"'],
  ] as const)('words the %s operator on a description', (operator, expected) => {
    const rule = ruleOf([{ kind: 'condition', attribute: 'description', operator, value: 'MARKET' }])

    expect(getRuleSummary(rule, CURRENCIES)).toBe(expected)
  })

  it('words a note the same way as a description', () => {
    expect(getRuleSummary(ruleOf([text('note', 'contains', 'rent')]), CURRENCIES)).toBe('Note contains "rent"')
  })

  it.each([
    ['is', 'Amount is'],
    ['at_least', 'Amount is at least'],
    ['at_most', 'Amount is at most'],
  ] as const)('words the %s operator on an amount shown by the app money formatting', (operator, words) => {
    const rule = ruleOf([{ kind: 'condition', attribute: 'amount', operator, value: 1250, currency: 'CAD' }])

    expect(getRuleSummary(rule, CURRENCIES)).toBe(`${words} ${formatCurrency(1250, 'CAD', CURRENCIES)}`)
  })

  it('reads the minor units against the currency, so the same figure is 100 times larger in a currency with no decimals', () => {
    const cad = getRuleSummary(
      ruleOf([{ kind: 'condition', attribute: 'amount', operator: 'is', value: 1250, currency: 'CAD' }]),
      CURRENCIES,
    )
    const jpy = getRuleSummary(
      ruleOf([{ kind: 'condition', attribute: 'amount', operator: 'is', value: 1250, currency: 'JPY' }]),
      CURRENCIES,
    )

    expect(cad).toContain('12.50')
    expect(jpy).toContain('1,250')
    expect(jpy).not.toContain('.')
  })

  it.each([
    ['in', 'Direction is money in'],
    ['out', 'Direction is money out'],
  ] as const)('words money %s', (value, expected) => {
    const rule = ruleOf([{ kind: 'condition', attribute: 'direction', operator: 'is', value }])

    expect(getRuleSummary(rule, CURRENCIES)).toBe(expected)
  })

  it.each([
    ['is', 'Account is Chequing'],
    ['is_not', "Account isn't Chequing"],
  ] as const)('names the account for %s', (operator, expected) => {
    const rule = ruleOf([
      {
        kind: 'condition',
        attribute: 'account',
        operator,
        value: 'a1',
        account_state: 'exists',
        account_name: 'Chequing',
      },
    ])

    expect(getRuleSummary(rule, CURRENCIES)).toBe(expected)
  })

  it('says a condition on a deleted account was deleted, whether it asked for the account or against it', () => {
    const deleted = (operator: 'is' | 'is_not'): ImportRuleItem => ({
      kind: 'condition',
      attribute: 'account',
      operator,
      value: 'a1',
      account_state: 'deleted',
      account_name: null,
    })

    expect(getRuleSummary(ruleOf([deleted('is')]), CURRENCIES)).toBe('Account was deleted (never matches)')
    expect(getRuleSummary(ruleOf([deleted('is_not')]), CURRENCIES)).toBe('Account was deleted (never matches)')
  })

  it('joins the conditions with and for All and or for Any, the later ones in lower case', () => {
    const conditions = [text('description', 'contains', 'a'), text('note', 'contains', 'b')]

    expect(getRuleSummary(ruleOf(conditions, 'all'), CURRENCIES)).toBe('Description contains "a" and note contains "b"')
    expect(getRuleSummary(ruleOf(conditions, 'any'), CURRENCIES)).toBe('Description contains "a" or note contains "b"')
  })

  it("puts a group in brackets, joined by its own match and not the rule's", () => {
    const rule = ruleOf(
      [
        text('description', 'contains', 'a'),
        { kind: 'group', match: 'any', conditions: [text('note', 'contains', 'b'), text('note', 'contains', 'c')] },
      ],
      'all',
    )

    expect(getRuleSummary(rule, CURRENCIES)).toBe(
      'Description contains "a" and (note contains "b" or note contains "c")',
    )
  })

  it('starts with a capital letter inside the bracket when the first condition is a group', () => {
    const rule = ruleOf(
      [
        { kind: 'group', match: 'any', conditions: [text('note', 'contains', 'b'), text('note', 'contains', 'c')] },
        text('description', 'contains', 'a'),
      ],
      'all',
    )

    expect(getRuleSummary(rule, CURRENCIES)).toBe(
      '(Note contains "b" or note contains "c") and description contains "a"',
    )
  })

  it('leaves a value of 40 characters whole, and cuts one of 41', () => {
    const summaryOf = (value: string) => getRuleSummary(ruleOf([text('description', 'contains', value)]), CURRENCIES)

    expect(summaryOf('x'.repeat(40))).toBe(`Description contains "${'x'.repeat(40)}"`)
    expect(summaryOf('x'.repeat(41))).toBe(`Description contains "${'x'.repeat(40)}…"`)
  })
})

describe('what a rule sets', () => {
  const named = (id: string) => ({ id, name: `Name ${id}` })

  it('lists one entry for each kind the rule sets, in the order merchant, category, tags', () => {
    const rule = { ...ruleOf([]), merchant: named('m'), category: named('c'), tags: [named('t1'), named('t2')] }

    expect(getRuleSets(rule).map(({ kind, spoken }) => [kind, spoken])).toEqual([
      ['merchant', 'Sets merchant'],
      ['category', 'Sets category'],
      ['tags', 'Adds tag'],
    ])
  })

  it('leaves out a kind the rule does not set, and calls a single tag a tag', () => {
    expect(getRuleSets({ ...ruleOf([]), category: named('c') }).map(({ kind }) => kind)).toEqual(['category'])
    expect(getRuleSets({ ...ruleOf([]), tags: [named('t')] }).map(({ kind }) => kind)).toEqual(['tag'])
    expect(getRuleSets(ruleOf([]))).toEqual([])
  })

  it('shows four tags and counts the rest, and counts nothing at four', () => {
    const tags = Array.from({ length: 5 }, (_, index) => named(`t${index}`))

    const [five] = getRuleSets({ ...ruleOf([]), tags })
    const [four] = getRuleSets({ ...ruleOf([]), tags: tags.slice(0, 4) })

    expect(five.values.map(({ id }) => id)).toEqual(['t0', 't1', 't2', 't3'])
    expect(five.hiddenCount).toBe(1)
    expect(four.hiddenCount).toBe(0)
  })
})
