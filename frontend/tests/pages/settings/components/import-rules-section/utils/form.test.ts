/**
 * Covers the import rule editor's form: what a saved rule fills in, how each change reshapes the form,
 * what stops a save, what is sent, and where the server's refusals land
 *
 * These tests catch an amount shown or sent at the wrong scale, a change of attribute that keeps an
 * operator the new attribute doesn't have, a refused save that never brings its problem into view, an
 * edit that sends conditions it didn't change, and a refusal at one condition shown on another row
 */
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { RULE_MODAL_IDS } from '@/pages/settings/components/import-rules-section/constants'
import type { ApiFieldError } from '@/api/auth'
import type { Currency } from '@/api/currency'
import type {
  CreateImportRulePayload,
  ImportRule,
  ImportRuleCondition,
  ImportRuleConditionRequest,
  ImportRuleItemRequest,
} from '@/api/import-rules'
import {
  buildBlankCondition,
  buildInitialRuleForm,
  buildRulePayload,
  buildRuleUpdatePayload,
  countConditions,
  getClearedErrorKeys,
  getConditionControlId,
  getConditionFieldKey,
  getCurrencyFieldKey,
  getGroupControlId,
  getGroupFieldKey,
  getNextRuleForm,
  getRuleControlIds,
  getRuleFieldOrder,
  getRuleServerErrors,
  MISSING_ACTIONS_MESSAGE,
  MISSING_TEXT_MESSAGE,
  validateRuleForm,
  WAITING_FOR_CURRENCIES_MESSAGE,
} from '@/pages/settings/components/import-rules-section/utils/form'
import type { ConditionForm, GroupForm, RuleForm } from '@/pages/settings/components/import-rules-section/types'
import { fromMinorUnits, isMinorUnitsAbove, MAX_MINOR_UNITS, toMinorUnits } from '@/utils/moneyInput'

const CURRENCIES: Currency[] = [
  { id: 'CAD', name: 'Canadian dollar', symbol: '$', minor_unit_exponent: 2 },
  { id: 'JPY', name: 'Japanese yen', symbol: '¥', minor_unit_exponent: 0 },
]

const ACCOUNT_ID = '5f0a8f6e-0c4d-4f55-9a3c-3c6f2f9d6a10'

/** Turns a request's condition into the shape the server returns, amounts in minor units */
function toResponseCondition(condition: ImportRuleConditionRequest): ImportRuleCondition {
  switch (condition.attribute) {
    case 'amount': {
      const exponent = CURRENCIES.find((currency) => currency.id === condition.currency)?.minor_unit_exponent ?? 2
      return { ...condition, value: toMinorUnits(condition.value, exponent) ?? 0 }
    }
    case 'account':
      return { ...condition, account_state: 'exists', account_name: 'Chequing' }
    default:
      return condition
  }
}

/** Builds the rule the server would return for a payload that was created */
function toRule(payload: CreateImportRulePayload): ImportRule {
  return {
    id: 'rule-1',
    name: payload.name,
    position: 0,
    match: payload.match,
    conditions: payload.conditions.map((item) =>
      item.kind === 'group'
        ? { ...item, conditions: item.conditions.map(toResponseCondition) }
        : toResponseCondition(item),
    ),
    merchant: payload.merchant_id ? { id: payload.merchant_id, name: 'Corner Cafe' } : null,
    category: payload.category_id ? { id: payload.category_id, name: 'Dining' } : null,
    tags: payload.tag_ids.map((id) => ({ id, name: `Tag ${id}` })),
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  }
}

const textCondition = (value: string): ImportRuleConditionRequest => ({
  kind: 'condition',
  attribute: 'description',
  operator: 'contains',
  value,
})

function buildPayload(overrides: Partial<CreateImportRulePayload> = {}): CreateImportRulePayload {
  return {
    name: 'Market',
    match: 'all',
    conditions: [textCondition('MARKET')],
    merchant_id: 'merchant-1',
    category_id: null,
    tag_ids: [],
    ...overrides,
  }
}

function formOf(payload: CreateImportRulePayload = buildPayload()): RuleForm {
  return buildInitialRuleForm(toRule(payload), CURRENCIES)
}

const conditionAt = (form: RuleForm, index: number) => form.items[index] as ConditionForm
const groupAt = (form: RuleForm, index: number) => form.items[index] as GroupForm

describe('seeding the editor', () => {
  it('starts a new rule with one blank description condition and nothing set', () => {
    const form = buildInitialRuleForm(null, CURRENCIES, 'CAD')

    expect(form).toMatchObject({ name: '', match: 'all', merchant: null, categoryId: '', tags: [] })
    expect(form.items).toHaveLength(1)
    expect(form.items[0]).toMatchObject({
      kind: 'condition',
      attribute: 'description',
      operator: 'contains',
      value: '',
    })
  })

  it("writes a saved amount in its own currency's decimal places", () => {
    const form = buildInitialRuleForm(
      toRule(
        buildPayload({
          conditions: [
            { kind: 'condition', attribute: 'amount', operator: 'at_least', value: '12.50', currency: 'CAD' },
            { kind: 'condition', attribute: 'amount', operator: 'at_most', value: '800', currency: 'JPY' },
          ],
        }),
      ),
      CURRENCIES,
    )

    expect(conditionAt(form, 0)).toMatchObject({ value: '12.50', currency: 'CAD' })
    expect(conditionAt(form, 1)).toMatchObject({ value: '800', currency: 'JPY' })
  })

  it('holds the merchant and tags with the names they were saved under', () => {
    const form = formOf(buildPayload({ category_id: 'category-1', tag_ids: ['tag-1'] }))

    expect(form.merchant).toEqual({ value: 'merchant-1', label: 'Corner Cafe' })
    expect(form.categoryId).toBe('category-1')
    expect(form.tags).toEqual([{ value: 'tag-1', label: 'Tag tag-1' }])
  })

  it('keeps a deleted account on its condition, with the name it had', () => {
    const rule = toRule(
      buildPayload({
        conditions: [{ kind: 'condition', attribute: 'account', operator: 'is', value: ACCOUNT_ID }],
      }),
    )
    const [item] = rule.conditions
    if (item.kind === 'group' || item.attribute !== 'account') throw new Error('expected an account condition')
    item.account_state = 'deleted'
    item.account_name = null

    const form = buildInitialRuleForm(rule, CURRENCIES)

    expect(conditionAt(form, 0)).toMatchObject({ value: ACCOUNT_ID, accountDeleted: true, accountName: null })
  })
})

describe('changing the form', () => {
  const baseCurrency = 'CAD'

  it('starts a condition over with the new attribute, apart from a switch between description and note', () => {
    let form = formOf(buildPayload({ conditions: [textCondition('MARKET')] }))
    const { key } = conditionAt(form, 0)

    form = getNextRuleForm(form, { type: 'condition', key, field: 'operator', value: 'starts_with' })
    form = getNextRuleForm(form, { type: 'condition', key, field: 'attribute', value: 'note' })
    expect(conditionAt(form, 0)).toMatchObject({ attribute: 'note', operator: 'starts_with', value: 'MARKET' })

    form = getNextRuleForm(form, { type: 'condition', key, field: 'attribute', value: 'amount' })
    expect(conditionAt(form, 0)).toMatchObject({ attribute: 'amount', operator: 'at_least', value: '' })

    form = getNextRuleForm(form, { type: 'condition', key, field: 'attribute', value: 'direction' })
    expect(conditionAt(form, 0)).toMatchObject({ attribute: 'direction', operator: 'is', value: 'out' })

    form = getNextRuleForm(form, { type: 'condition', key, field: 'attribute', value: 'account' })
    expect(conditionAt(form, 0)).toMatchObject({ attribute: 'account', operator: 'is', value: '', accountName: null })
  })

  it('names the account chosen on an account condition and forgets the name when another is chosen', () => {
    let form = getNextRuleForm(formOf(), { type: 'addCondition', groupKey: null, currency: baseCurrency })
    const { key } = conditionAt(form, 1)
    form = getNextRuleForm(form, { type: 'condition', key, field: 'attribute', value: 'account' })

    form = getNextRuleForm(form, { type: 'condition', key, field: 'value', value: ACCOUNT_ID, label: 'Chequing' })

    expect(conditionAt(form, 1)).toMatchObject({ value: ACCOUNT_ID, accountName: 'Chequing', accountDeleted: false })
  })

  it('adds conditions to the top list and to one group only', () => {
    let form = getNextRuleForm(formOf(), { type: 'addGroup', currency: baseCurrency })
    const group = groupAt(form, 1)
    expect(group.conditions).toHaveLength(1)

    form = getNextRuleForm(form, { type: 'addCondition', groupKey: group.key, currency: baseCurrency })
    form = getNextRuleForm(form, { type: 'addCondition', groupKey: null, currency: baseCurrency })

    expect(form.items).toHaveLength(3)
    expect(groupAt(form, 1).conditions).toHaveLength(2)
    expect(countConditions(form.items)).toBe(4)
  })

  it('removes a condition or a group by its key, wherever it sits', () => {
    let form = getNextRuleForm(formOf(), { type: 'addGroup', currency: baseCurrency })
    const group = groupAt(form, 1)
    form = getNextRuleForm(form, { type: 'addCondition', groupKey: group.key, currency: baseCurrency })

    form = getNextRuleForm(form, { type: 'remove', key: groupAt(form, 1).conditions[0].key })
    expect(groupAt(form, 1).conditions).toHaveLength(1)

    form = getNextRuleForm(form, { type: 'remove', key: group.key })
    expect(form.items).toHaveLength(1)
  })

  it('moves an item within the top list and a condition within its own group', () => {
    let form = formOf(buildPayload({ conditions: [textCondition('a'), textCondition('b'), textCondition('c')] }))

    form = getNextRuleForm(form, { type: 'move', groupKey: null, from: 2, to: 0 })
    expect(form.items.map((item) => (item as ConditionForm).value)).toEqual(['c', 'a', 'b'])

    form = formOf(
      buildPayload({
        conditions: [{ kind: 'group', match: 'any', conditions: [textCondition('x'), textCondition('y')] }],
      }),
    )
    form = getNextRuleForm(form, { type: 'move', groupKey: groupAt(form, 0).key, from: 0, to: 1 })
    expect(groupAt(form, 0).conditions.map((condition) => condition.value)).toEqual(['y', 'x'])
  })

  it.each([
    ['a place before the first', -1],
    ['a place after the last', 3],
    ['its own place', 1],
  ])('leaves the order alone for a move to %s', (_name, to) => {
    const form = formOf(buildPayload({ conditions: [textCondition('a'), textCondition('b'), textCondition('c')] }))

    expect(getNextRuleForm(form, { type: 'move', groupKey: null, from: 1, to }).items).toBe(form.items)
  })

  it('changes a condition inside a group and leaves the same row in another group and the top list alone', () => {
    let form = formOf(
      buildPayload({
        conditions: [
          textCondition('top'),
          { kind: 'group', match: 'any', conditions: [textCondition('one'), textCondition('two')] },
          { kind: 'group', match: 'any', conditions: [textCondition('three')] },
        ],
      }),
    )
    const target = groupAt(form, 1).conditions[1]

    form = getNextRuleForm(form, { type: 'condition', key: target.key, field: 'value', value: 'changed' })
    form = getNextRuleForm(form, { type: 'condition', key: target.key, field: 'operator', value: 'ends_with' })

    expect(groupAt(form, 1).conditions[1]).toMatchObject({ value: 'changed', operator: 'ends_with' })
    expect(groupAt(form, 1).conditions[0]).toMatchObject({ value: 'one', operator: 'contains' })
    expect(groupAt(form, 2).conditions[0]).toMatchObject({ value: 'three' })
    expect(conditionAt(form, 0)).toMatchObject({ value: 'top' })
  })

  it("sets a group's own All or Any apart from the rule's", () => {
    let form = getNextRuleForm(formOf(), { type: 'addGroup', currency: baseCurrency })

    form = getNextRuleForm(form, { type: 'groupMatch', key: groupAt(form, 1).key, value: 'all' })
    form = getNextRuleForm(form, { type: 'match', value: 'any' })

    expect(form.match).toBe('any')
    expect(groupAt(form, 1).match).toBe('all')
  })
})

describe('what stops a save', () => {
  it('accepts a complete rule', () => {
    expect(validateRuleForm(formOf())).toEqual({})
  })

  it('asks for a name', () => {
    const form = getNextRuleForm(formOf(), { type: 'name', value: '   ' })

    expect(validateRuleForm(form).name).toBe('Name is required')
  })

  it('asks for the text to match on the row that has none, whichever kind of text it is', () => {
    let form = formOf(buildPayload({ conditions: [textCondition('a'), textCondition('b')] }))
    form = getNextRuleForm(form, { type: 'condition', key: conditionAt(form, 1).key, field: 'value', value: '  ' })

    expect(validateRuleForm(form)).toEqual({ [getConditionFieldKey(conditionAt(form, 1).key)]: MISSING_TEXT_MESSAGE })
  })

  it.each([
    ['no amount', '', 'Enter an amount'],
    ['an amount of zero', '0.00', 'Amount must be greater than zero'],
    ['a negative amount', '-5', 'Amount must be greater than zero'],
  ])('refuses %s', (_name, value, message) => {
    let form = getNextRuleForm(formOf(), { type: 'addCondition', groupKey: null, currency: 'CAD' })
    const { key } = conditionAt(form, 1)
    form = getNextRuleForm(form, { type: 'condition', key, field: 'attribute', value: 'amount' })
    form = getNextRuleForm(form, { type: 'condition', key, field: 'value', value })

    expect(validateRuleForm(form)[getConditionFieldKey(key)]).toBe(message)
  })

  it.each([
    ['at the top', false],
    ['inside a group', true],
  ])('starts a saved condition switched to Amount in the base currency, as a new one does, %s', (_where, inGroup) => {
    const payload = buildPayload({
      conditions: [
        inGroup ? { kind: 'group', match: 'all', conditions: [textCondition('MARKET')] } : textCondition('MARKET'),
      ],
    })
    let form = buildInitialRuleForm(toRule(payload), CURRENCIES, 'CAD')
    const target = () => (inGroup ? groupAt(form, 0).conditions[0] : conditionAt(form, 0))
    const { key } = target()

    form = getNextRuleForm(form, { type: 'condition', key, field: 'attribute', value: 'amount' })
    expect(target()).toMatchObject({ attribute: 'amount', currency: 'CAD', savedMinorUnits: null })

    form = getNextRuleForm(form, { type: 'condition', key, field: 'value', value: '12.50' })
    expect(validateRuleForm(form)).toEqual({})
  })

  it('asks for a currency on the currency, which takes focus, and not on the amount', () => {
    let form = buildInitialRuleForm(toRule(buildPayload()), CURRENCIES)
    const { key } = conditionAt(form, 0)
    form = getNextRuleForm(form, { type: 'condition', key, field: 'attribute', value: 'amount' })
    form = getNextRuleForm(form, { type: 'condition', key, field: 'value', value: '5' })

    expect(validateRuleForm(form)).toEqual({ [getCurrencyFieldKey(key)]: 'Select a currency' })
  })

  it('asks for an account on an account condition with none chosen', () => {
    let form = getNextRuleForm(formOf(), { type: 'addCondition', groupKey: null, currency: 'CAD' })
    const { key } = conditionAt(form, 1)
    form = getNextRuleForm(form, { type: 'condition', key, field: 'attribute', value: 'account' })

    expect(validateRuleForm(form)[getConditionFieldKey(key)]).toBe('Select an account')
  })

  it('asks for a condition in a group left empty, and for at least one condition in all', () => {
    let form = getNextRuleForm(formOf(), { type: 'addGroup', currency: 'CAD' })
    const group = groupAt(form, 1)
    form = getNextRuleForm(form, { type: 'remove', key: group.conditions[0].key })
    expect(validateRuleForm(form)[getGroupFieldKey(group.key)]).toBe('Please add a condition to this group')

    form = { ...form, items: [] }
    expect(validateRuleForm(form).conditions).toBe('Please add at least one condition')
  })

  it('leaves the count of conditions a person may hold in all to the server, which counts every rule', () => {
    const filled = () => ({ ...buildBlankCondition('CAD'), value: 'text' })
    const holding = (count: number) => ({
      ...formOf(),
      items: [
        { kind: 'group', key: 'g', match: 'all', conditions: Array.from({ length: count }, filled) } as GroupForm,
      ],
    })

    expect(validateRuleForm(holding(150)).conditions).toBeUndefined()
  })

  it('accepts a name of 100 characters and refuses one of 101, counting the name without its edge spaces', () => {
    const named = (name: string) => validateRuleForm({ ...formOf(), name }).name

    expect(named('n'.repeat(100))).toBeUndefined()
    expect(named(` ${'n'.repeat(100)} `)).toBeUndefined()
    expect(named('n'.repeat(101))).toBe('Name must be 100 characters or less')
  })

  it.each(['description', 'note'] as const)(
    'accepts %s text of 200 characters and refuses 201 with a message, counting it without its edge spaces and never cutting what was pasted',
    (attribute) => {
      const problem = (value: string) => {
        let form = formOf()
        const { key } = conditionAt(form, 0)
        form = getNextRuleForm(form, { type: 'condition', key, field: 'attribute', value: attribute })
        form = getNextRuleForm(form, { type: 'condition', key, field: 'value', value })
        return validateRuleForm(form)[getConditionFieldKey(key)]
      }

      expect(problem('t'.repeat(200))).toBeUndefined()
      expect(problem(`  ${'t'.repeat(200)}  `)).toBeUndefined()
      expect(problem('t'.repeat(201))).toBe('Text must be 200 characters or less')
      expect(problem(`  ${'t'.repeat(201)}  `)).toBe('Text must be 200 characters or less')
    },
  )

  it('refuses text of only spaces as an empty value, and sends text with its edge spaces trimmed', () => {
    let form = formOf()
    const { key } = conditionAt(form, 0)
    form = getNextRuleForm(form, { type: 'condition', key, field: 'value', value: '   ' })
    expect(validateRuleForm(form)[getConditionFieldKey(key)]).toBe(MISSING_TEXT_MESSAGE)

    form = getNextRuleForm(form, { type: 'condition', key, field: 'value', value: ' AMZN ' })
    expect(buildRulePayload(form).conditions).toEqual([textCondition('AMZN')])
  })

  it('asks for a merchant, a category or a tag when the rule sets none', () => {
    const form = formOf(buildPayload({ merchant_id: null }))

    expect(validateRuleForm(form).actions).toBe(MISSING_ACTIONS_MESSAGE)
    expect(validateRuleForm({ ...form, categoryId: 'category-1' }).actions).toBeUndefined()
    expect(validateRuleForm({ ...form, tags: [{ value: 'tag-1', label: 'Work' }] }).actions).toBeUndefined()
  })

  it('accepts 32 tags and refuses the 33rd', () => {
    const tagsOf = (count: number) =>
      Array.from({ length: count }, (_, index) => ({ value: `tag-${index}`, label: `Tag ${index}` }))

    expect(validateRuleForm({ ...formOf(), tags: tagsOf(32) }).actions).toBeUndefined()
    expect(validateRuleForm({ ...formOf(), tags: tagsOf(33) }).actions).toBe('Choose at most 32 tags')
  })

  describe('a saved amount whose currency is not known yet', () => {
    const KUWAITI_DINAR: Currency = { id: 'KWD', name: 'Kuwaiti dinar', symbol: 'KD', minor_unit_exponent: 3 }
    // 12.500 dinars is 12500 minor units, where a guess of two decimals would read it as 125.00
    const saved: ImportRule = {
      ...toRule(buildPayload()),
      conditions: [{ kind: 'condition', attribute: 'amount', operator: 'at_least', value: 12500, currency: 'KWD' }],
    }

    it('holds the saved figure and shows nothing, rather than writing it at a guessed two decimals', () => {
      const form = buildInitialRuleForm(saved, [])

      expect(conditionAt(form, 0)).toMatchObject({ value: '', currency: 'KWD', savedMinorUnits: 12500 })
    })

    it('stops a save until the currencies arrive, then writes the amount at the currency own decimals', () => {
      let form = buildInitialRuleForm(saved, [])
      const { key } = conditionAt(form, 0)
      // The message sits on the currency, because the locked amount can't take focus
      expect(validateRuleForm(form)[getCurrencyFieldKey(key)]).toBe(WAITING_FOR_CURRENCIES_MESSAGE)
      expect(validateRuleForm(form)[getConditionFieldKey(key)]).toBeUndefined()

      form = getNextRuleForm(form, { type: 'currencies', currencies: [KUWAITI_DINAR] })

      expect(conditionAt(form, 0)).toMatchObject({ value: '12.500', savedMinorUnits: null })
      expect(validateRuleForm(form)).toEqual({})
      expect(buildRuleUpdatePayload(form, saved, [KUWAITI_DINAR])).toEqual({})
    })

    it('keeps waiting through a change of operator and leaves a currency that is still unknown alone', () => {
      let form = buildInitialRuleForm(saved, [])
      form = getNextRuleForm(form, {
        type: 'condition',
        key: conditionAt(form, 0).key,
        field: 'operator',
        value: 'at_most',
      })
      form = getNextRuleForm(form, { type: 'currencies', currencies: CURRENCIES })

      expect(conditionAt(form, 0)).toMatchObject({ operator: 'at_most', value: '', savedMinorUnits: 12500 })
    })

    it('forgets the saved figure once an amount is typed', () => {
      let form = buildInitialRuleForm(saved, [KUWAITI_DINAR])
      form = getNextRuleForm(form, { type: 'condition', key: conditionAt(form, 0).key, field: 'value', value: '1.250' })

      expect(conditionAt(form, 0)).toMatchObject({ value: '1.250', savedMinorUnits: null })
    })
  })

  it('gives every problem a place a refused save can bring into view', () => {
    let form = getNextRuleForm(formOf(buildPayload({ merchant_id: null })), { type: 'name', value: '' })
    form = getNextRuleForm(form, { type: 'addGroup', currency: 'CAD' })
    form = getNextRuleForm(form, { type: 'condition', key: conditionAt(form, 0).key, field: 'value', value: '' })
    form = getNextRuleForm(form, { type: 'remove', key: groupAt(form, 1).conditions[0].key })

    const problems = validateRuleForm(form)
    const order = getRuleFieldOrder(form)
    const controls = getRuleControlIds(form)
    const textKey = getConditionFieldKey(conditionAt(form, 0).key)
    const groupKey = getGroupFieldKey(groupAt(form, 1).key)

    // A refused save focuses the first of these, and the others follow in the order the editor draws them
    expect(order.filter((key) => key in problems)).toEqual(['name', textKey, groupKey, 'actions'])
    expect(Object.keys(problems)).toHaveLength(4)
    expect(controls).toMatchObject({
      name: RULE_MODAL_IDS.name,
      [textKey]: getConditionControlId(conditionAt(form, 0).key),
      [groupKey]: getGroupControlId(groupAt(form, 1).key),
      actions: RULE_MODAL_IDS.merchant,
    })
  })
})

describe('what is sent', () => {
  it('sends the name trimmed, amounts as the decimal text the field holds and a cleared merchant as null', () => {
    const form = formOf(
      buildPayload({
        name: ' Market ',
        merchant_id: null,
        category_id: 'category-1',
        conditions: [
          { kind: 'condition', attribute: 'amount', operator: 'is', value: '12.5', currency: 'CAD' },
          { kind: 'condition', attribute: 'direction', operator: 'is', value: 'in' },
        ],
      }),
    )

    expect(buildRulePayload(form)).toEqual({
      name: 'Market',
      match: 'all',
      conditions: [
        { kind: 'condition', attribute: 'amount', operator: 'is', value: '12.50', currency: 'CAD' },
        { kind: 'condition', attribute: 'direction', operator: 'is', value: 'in' },
      ],
      merchant_id: null,
      category_id: 'category-1',
      tag_ids: [],
    })
  })

  it.each([
    ['CAD', '92233720368547758.07'],
    ['JPY', '9223372036854775807'],
  ])('sends an amount at the largest the server stores in %s as typed, with no rounding', (currency, amount) => {
    // MAX_MINOR_UNITS counted in the currency's own decimal places. A number can't hold it exactly
    expect(isMinorUnitsAbove(amount, currency === 'JPY' ? 0 : 2, MAX_MINOR_UNITS)).toBe(false)
    let form = formOf()
    const { key } = conditionAt(form, 0)
    form = getNextRuleForm(form, { type: 'condition', key, field: 'attribute', value: 'amount' })
    form = getNextRuleForm(form, { type: 'condition', key, field: 'currency', value: currency })
    form = getNextRuleForm(form, { type: 'condition', key, field: 'value', value: amount })

    expect(validateRuleForm(form)).toEqual({})
    expect(buildRulePayload(form).conditions).toEqual([
      { kind: 'condition', attribute: 'amount', operator: 'at_least', value: amount, currency },
    ])
  })

  it('sends a group as its own all or any with its conditions', () => {
    const payload = buildPayload({
      conditions: [
        textCondition('MARKET'),
        {
          kind: 'group',
          match: 'any',
          conditions: [{ kind: 'condition', attribute: 'account', operator: 'is_not', value: ACCOUNT_ID }],
        },
      ],
    })

    expect(buildRulePayload(formOf(payload)).conditions).toEqual(payload.conditions)
  })

  describe('an edit', () => {
    const payload = buildPayload({ category_id: 'category-1', tag_ids: ['tag-1', 'tag-2'] })
    const rule = toRule(payload)

    it('sends nothing when nothing changed, whatever order the tags were picked in', () => {
      const form = { ...formOf(payload), tags: [...formOf(payload).tags].reverse() }

      expect(buildRuleUpdatePayload(form, rule, CURRENCIES)).toEqual({})
    })

    it('sends only the fields that changed, a cleared merchant as null', () => {
      let form = getNextRuleForm(formOf(payload), { type: 'name', value: 'Groceries' })
      form = getNextRuleForm(form, { type: 'merchant', value: null })

      expect(buildRuleUpdatePayload(form, rule, CURRENCIES)).toEqual({ name: 'Groceries', merchant_id: null })
    })

    it('sends the conditions once one changed, and not before', () => {
      let form = formOf(payload)
      form = getNextRuleForm(form, {
        type: 'condition',
        key: conditionAt(form, 0).key,
        field: 'value',
        value: 'MARKET 2',
      })

      expect(buildRuleUpdatePayload(form, rule, CURRENCIES)).toEqual({ conditions: [textCondition('MARKET 2')] })
    })

    it('sends the match alone when only All or Any changed', () => {
      const form = getNextRuleForm(formOf(payload), { type: 'match', value: 'any' })

      expect(buildRuleUpdatePayload(form, rule, CURRENCIES)).toEqual({ match: 'any' })
    })

    it('sends the category alone when only the category changed, and null once it is cleared', () => {
      const changed = getNextRuleForm(formOf(payload), { type: 'category', value: 'category-2' })
      const cleared = getNextRuleForm(formOf(payload), { type: 'category', value: '' })

      expect(buildRuleUpdatePayload(changed, rule, CURRENCIES)).toEqual({ category_id: 'category-2' })
      expect(buildRuleUpdatePayload(cleared, rule, CURRENCIES)).toEqual({ category_id: null })
    })

    it('sends the tags alone when only the tags changed, all of them, including when one is dropped', () => {
      const added = getNextRuleForm(formOf(payload), {
        type: 'tags',
        value: [...formOf(payload).tags, { value: 'tag-3', label: 'Three' }],
      })
      const dropped = getNextRuleForm(formOf(payload), { type: 'tags', value: formOf(payload).tags.slice(0, 1) })

      expect(buildRuleUpdatePayload(added, rule, CURRENCIES)).toEqual({ tag_ids: ['tag-1', 'tag-2', 'tag-3'] })
      expect(buildRuleUpdatePayload(dropped, rule, CURRENCIES)).toEqual({ tag_ids: ['tag-1'] })
    })

    it('lets a rule with a condition on a deleted account be renamed without sending that condition again', () => {
      const withAccount = toRule(
        buildPayload({ conditions: [{ kind: 'condition', attribute: 'account', operator: 'is', value: ACCOUNT_ID }] }),
      )
      const [item] = withAccount.conditions
      if (item.kind === 'group' || item.attribute !== 'account') throw new Error('expected an account condition')
      item.account_state = 'deleted'
      item.account_name = null

      const form = getNextRuleForm(buildInitialRuleForm(withAccount, CURRENCIES), { type: 'name', value: 'Renamed' })

      expect(buildRuleUpdatePayload(form, withAccount, CURRENCIES)).toEqual({ name: 'Renamed' })
    })
  })
})

describe('where the server puts its refusals', () => {
  const error = (path: Array<string | number>, message = 'Refused'): ApiFieldError => ({
    field: String(path.filter((part) => typeof part === 'string').at(-1) ?? ''),
    path,
    message,
  })

  const form = formOf(
    buildPayload({
      conditions: [
        textCondition('a'),
        textCondition('b'),
        { kind: 'condition', attribute: 'amount', operator: 'is', value: '5.00', currency: 'CAD' },
        { kind: 'group', match: 'any', conditions: [textCondition('x'), textCondition('y')] },
      ],
    }),
  )

  it('puts an error at conditions[2] on the third row, whichever union tags the path carries', () => {
    const { errors, unplaced } = getRuleServerErrors(
      [error(['conditions', 2, 'condition', 'amount', 'value'], 'Amount must be greater than zero')],
      form,
    )

    expect(errors).toEqual({ [getConditionFieldKey(conditionAt(form, 2).key)]: 'Amount must be greater than zero' })
    expect(unplaced).toEqual([])
  })

  it('puts an error inside a group on its own condition, and one on the group on the group', () => {
    const group = groupAt(form, 3)

    const inner = getRuleServerErrors(
      [error(['conditions', 3, 'group', 'conditions', 1, 'amount', 'value'], 'Inside')],
      form,
    )
    const outer = getRuleServerErrors([error(['conditions', 3, 'group', 'match'], 'On the group')], form)

    expect(inner.errors).toEqual({ [getConditionFieldKey(group.conditions[1].key)]: 'Inside' })
    expect(outer.errors).toEqual({ [getGroupFieldKey(group.key)]: 'On the group' })
  })

  it('puts a refusal of the currency on the currency dropdown, and one of the amount on the amount', () => {
    const key = conditionAt(form, 2).key

    const currency = getRuleServerErrors(
      [error(['conditions', 2, 'condition', 'amount', 'currency'], 'Currency not found')],
      form,
    )
    const amount = getRuleServerErrors([error(['conditions', 2, 'condition', 'amount', 'value'], 'Too big')], form)

    expect(currency.errors).toEqual({ [getCurrencyFieldKey(key)]: 'Currency not found' })
    expect(amount.errors).toEqual({ [getConditionFieldKey(key)]: 'Too big' })
    expect(getRuleControlIds(form)[getCurrencyFieldKey(key)]).toBe(
      `${getRuleControlIds(form)[getConditionFieldKey(key)]}-currency`,
    )
    expect(getRuleFieldOrder(form)).toContain(getCurrencyFieldKey(key))
  })

  it('puts the name, the actions and the list of conditions on their own places', () => {
    const { errors } = getRuleServerErrors(
      [
        error(['name'], 'A name problem'),
        error(['actions'], 'Please choose a merchant, a category or at least one tag'),
        error(['category_id'], 'Category not found'),
        error(['tag_ids', 1], 'Tag not found'),
        error(['conditions'], 'Too many'),
      ],
      form,
    )

    expect(errors).toEqual({
      name: 'A name problem',
      actions: 'Please choose a merchant, a category or at least one tag',
      conditions: 'Too many',
    })
  })

  it('returns what it cannot place, and an index past the rows on the list of conditions', () => {
    const { errors, unplaced } = getRuleServerErrors(
      [error(['unheard_of'], 'Strange'), error(['conditions', 9, 'condition', 'description', 'value'], 'Gone')],
      form,
    )

    expect(unplaced).toEqual(['Strange'])
    expect(errors).toEqual({ conditions: 'Gone' })
  })
})

describe('which refusals a change clears', () => {
  const key = 'row-9'

  it('clears the name on a typed name and the row, with its currency, on a change to the row', () => {
    expect(getClearedErrorKeys({ type: 'name', value: 'x' })).toEqual(['name'])
    expect(getClearedErrorKeys({ type: 'condition', key, field: 'value', value: 'x' })).toEqual([
      getConditionFieldKey(key),
      getCurrencyFieldKey(key),
    ])
  })

  it('clears the row, its group and the list of conditions when the row goes', () => {
    expect(getClearedErrorKeys({ type: 'remove', key })).toEqual([
      getConditionFieldKey(key),
      getCurrencyFieldKey(key),
      getGroupFieldKey(key),
      'conditions',
    ])
  })

  it('clears the actions on a merchant, a category or tags, and the list of conditions on any other change', () => {
    expect(getClearedErrorKeys({ type: 'merchant', value: null })).toEqual(['actions'])
    expect(getClearedErrorKeys({ type: 'category', value: '' })).toEqual(['actions'])
    expect(getClearedErrorKeys({ type: 'tags', value: [] })).toEqual(['actions'])
    expect(getClearedErrorKeys({ type: 'addCondition', groupKey: null, currency: 'CAD' })).toEqual(['conditions'])
  })
})

describe('a rule sent and read back', () => {
  const text = fc.string({ minLength: 1, maxLength: 40 }).filter((value) => value.trim() === value && value !== '')

  const amount = fc
    .tuple(fc.constantFrom('CAD', 'JPY'), fc.integer({ min: 1, max: 999_999_999 }))
    .map(([currency, minorUnits]): ImportRuleConditionRequest => {
      const exponent = currency === 'JPY' ? 0 : 2
      return {
        kind: 'condition',
        attribute: 'amount',
        operator: 'is',
        value: fromMinorUnits(minorUnits, exponent),
        currency,
      }
    })

  const condition: fc.Arbitrary<ImportRuleConditionRequest> = fc.oneof(
    fc.record({
      kind: fc.constant('condition' as const),
      attribute: fc.constantFrom('description' as const, 'note' as const),
      operator: fc.constantFrom('contains' as const, 'not_contains' as const, 'is' as const, 'starts_with' as const),
      value: text,
    }),
    fc.record({
      kind: fc.constant('condition' as const),
      attribute: fc.constant('direction' as const),
      operator: fc.constant('is' as const),
      value: fc.constantFrom('in' as const, 'out' as const),
    }),
    fc.record({
      kind: fc.constant('condition' as const),
      attribute: fc.constant('account' as const),
      operator: fc.constantFrom('is' as const, 'is_not' as const),
      value: fc.uuid(),
    }),
    amount,
  )

  const item: fc.Arbitrary<ImportRuleItemRequest> = fc.oneof(
    condition,
    fc.record({
      kind: fc.constant('group' as const),
      match: fc.constantFrom('all' as const, 'any' as const),
      conditions: fc.array(condition, { minLength: 1, maxLength: 4 }),
    }),
  )

  const payload: fc.Arbitrary<CreateImportRulePayload> = fc.record({
    name: text,
    match: fc.constantFrom('all' as const, 'any' as const),
    conditions: fc.array(item, { minLength: 1, maxLength: 5 }),
    merchant_id: fc.option(fc.uuid(), { nil: null }),
    category_id: fc.option(fc.uuid(), { nil: null }),
    tag_ids: fc.uniqueArray(fc.uuid(), { maxLength: 4 }),
  })

  it('comes back as the same payload, whatever the conditions, groups and currencies', () => {
    fc.assert(
      fc.property(payload, (sent) => {
        expect(buildRulePayload(buildInitialRuleForm(toRule(sent), CURRENCIES))).toEqual(sent)
      }),
    )
  })
})
