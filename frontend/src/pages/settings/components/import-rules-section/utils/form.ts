import type { ApiFieldError } from '@/api/auth'
import type { Currency } from '@/api/currency'
import type {
  CreateImportRulePayload,
  ImportRule,
  ImportRuleCondition,
  ImportRuleConditionRequest,
  ImportRuleItemRequest,
  ImportRuleMatch,
  UpdateImportRulePayload,
} from '@/api/import-rules'
import {
  DEFAULT_OPERATOR,
  MAX_RULE_NAME_LENGTH,
  MAX_RULE_TAGS,
  MAX_RULE_TEXT_LENGTH,
  RULE_MODAL_IDS,
} from '@/pages/settings/components/import-rules-section/constants'
import type {
  ConditionAttribute,
  ConditionForm,
  GroupForm,
  RuleFieldErrors,
  RuleFieldKey,
  RuleForm,
  RuleFormAction,
  RuleItemForm,
} from '@/pages/settings/components/import-rules-section/types'
import { findCurrencyExponent, fromMinorUnits, isValidMoneyInput } from '@/utils/moneyInput'

export const MISSING_TEXT_MESSAGE = 'Enter the text to match'
export const MISSING_ACTIONS_MESSAGE = 'Please choose a merchant, a category or at least one tag'
export const WAITING_FOR_CURRENCIES_MESSAGE = 'Please wait for the currencies to load'

let lastKey = 0

/**
 * Makes the key a new condition or group is known by while the editor is open. No payload carries it
 */
export function createFormKey(): string {
  lastKey += 1
  return `row-${lastKey}`
}

/**
 * Builds a blank condition, a description that contains nothing yet
 *
 * @param currency - The currency an amount condition would start in
 */
export function buildBlankCondition(currency: string): ConditionForm {
  return {
    kind: 'condition',
    key: createFormKey(),
    attribute: 'description',
    operator: DEFAULT_OPERATOR.description,
    value: '',
    currency,
    accountName: null,
    accountDeleted: false,
    savedMinorUnits: null,
  }
}

function buildConditionFromRule(
  condition: ImportRuleCondition,
  currencies: Currency[],
  baseCurrency: string,
): ConditionForm {
  const base = {
    kind: 'condition' as const,
    key: createFormKey(),
    attribute: condition.attribute,
    operator: condition.operator,
    // A saved condition that isn't an amount is switched to one in the base currency, as a new condition is
    currency: baseCurrency,
    accountName: null,
    accountDeleted: false,
    savedMinorUnits: null,
  }
  switch (condition.attribute) {
    case 'amount': {
      // Without the currency's own decimal places the amount can't be written, so it waits for them
      const exponent = findCurrencyExponent(currencies, condition.currency)
      return {
        ...base,
        value: exponent === null ? '' : fromMinorUnits(condition.value, exponent),
        currency: condition.currency,
        savedMinorUnits: exponent === null ? condition.value : null,
      }
    }
    case 'account':
      return {
        ...base,
        value: condition.value,
        accountName: condition.account_name,
        accountDeleted: condition.account_state === 'deleted',
      }
    default:
      return { ...base, value: condition.value }
  }
}

/**
 * Seeds the editor with a saved rule, or with an empty one holding a single blank condition
 *
 * Saved amounts come back as whole minor units and are written as the decimal text the money field
 * holds, in each condition's own currency
 *
 * @param rule - The rule being edited, or null for a new one
 * @param currencies - The currencies, for the decimal places each amount is written with
 * @param baseCurrency - The currency a new amount condition starts in
 */
export function buildInitialRuleForm(rule: ImportRule | null, currencies: Currency[], baseCurrency = ''): RuleForm {
  if (!rule) {
    return {
      name: '',
      match: 'all',
      items: [buildBlankCondition(baseCurrency)],
      merchant: null,
      categoryId: '',
      tags: [],
    }
  }

  return {
    name: rule.name,
    match: rule.match,
    items: rule.conditions.map((item): RuleItemForm => {
      if (item.kind === 'group') {
        return {
          kind: 'group',
          key: createFormKey(),
          match: item.match,
          conditions: item.conditions.map((condition) => buildConditionFromRule(condition, currencies, baseCurrency)),
        }
      }
      return buildConditionFromRule(item, currencies, baseCurrency)
    }),
    merchant: rule.merchant ? { value: rule.merchant.id, label: rule.merchant.name } : null,
    categoryId: rule.category?.id ?? '',
    tags: rule.tags.map((tag) => ({ value: tag.id, label: tag.name })),
  }
}

function changeCondition(
  condition: ConditionForm,
  field: 'attribute' | 'operator' | 'value' | 'currency',
  value: string,
  label: string | undefined,
): ConditionForm {
  if (field === 'attribute') {
    const attribute = value as ConditionAttribute
    const keepsText = isTextAttribute(attribute) && isTextAttribute(condition.attribute)
    return {
      ...condition,
      attribute,
      operator: keepsText ? condition.operator : DEFAULT_OPERATOR[attribute],
      value: keepsText ? condition.value : attribute === 'direction' ? 'out' : '',
      accountName: null,
      accountDeleted: false,
      savedMinorUnits: null,
    }
  }
  if (field === 'value' && condition.attribute === 'account') {
    return { ...condition, value, accountName: label ?? null, accountDeleted: false }
  }
  // Typing an amount or choosing another currency replaces the saved amount, while the operator leaves it be
  const replacesAmount = field === 'value' || field === 'currency'
  return { ...condition, [field]: value, savedMinorUnits: replacesAmount ? null : condition.savedMinorUnits }
}

/**
 * Writes each saved amount that was waiting for its currency's decimal places, once the currencies are known
 */
function settleSavedAmounts(condition: ConditionForm, currencies: Currency[]): ConditionForm {
  if (condition.savedMinorUnits === null) return condition
  const exponent = findCurrencyExponent(currencies, condition.currency)
  if (exponent === null) return condition
  return { ...condition, value: fromMinorUnits(condition.savedMinorUnits, exponent), savedMinorUnits: null }
}

function isTextAttribute(attribute: ConditionAttribute): boolean {
  return attribute === 'description' || attribute === 'note'
}

function mapConditions(items: RuleItemForm[], map: (condition: ConditionForm) => ConditionForm): RuleItemForm[] {
  return items.map((item) => (item.kind === 'group' ? { ...item, conditions: item.conditions.map(map) } : map(item)))
}

function moveWithin<T>(list: T[], from: number, to: number): T[] {
  if (from === to || from < 0 || to < 0 || from >= list.length || to >= list.length) return list
  const next = [...list]
  const [moved] = next.splice(from, 1)
  next.splice(to, 0, moved)
  return next
}

/**
 * Applies one change to the editor's form, leaving the rest as it was
 *
 * Choosing another attribute starts the condition over with that attribute's own operator and an
 * empty value. A switch between description and note keeps what was typed
 */
export function getNextRuleForm(form: RuleForm, action: RuleFormAction): RuleForm {
  switch (action.type) {
    case 'name':
      return { ...form, name: action.value }
    case 'match':
      return { ...form, match: action.value }
    case 'addCondition': {
      const condition = buildBlankCondition(action.currency)
      if (action.groupKey === null) return { ...form, items: [...form.items, condition] }
      return {
        ...form,
        items: form.items.map((item) =>
          item.kind === 'group' && item.key === action.groupKey
            ? { ...item, conditions: [...item.conditions, condition] }
            : item,
        ),
      }
    }
    case 'addGroup': {
      const group: GroupForm = {
        kind: 'group',
        key: createFormKey(),
        match: 'any',
        conditions: [buildBlankCondition(action.currency)],
      }
      return { ...form, items: [...form.items, group] }
    }
    case 'remove':
      return {
        ...form,
        items: form.items
          .filter((item) => item.key !== action.key)
          .map((item) =>
            item.kind === 'group'
              ? { ...item, conditions: item.conditions.filter((condition) => condition.key !== action.key) }
              : item,
          ),
      }
    case 'condition':
      return {
        ...form,
        items: mapConditions(form.items, (condition) =>
          condition.key === action.key
            ? changeCondition(condition, action.field, action.value, action.label)
            : condition,
        ),
      }
    case 'groupMatch':
      return {
        ...form,
        items: form.items.map((item) =>
          item.kind === 'group' && item.key === action.key ? { ...item, match: action.value } : item,
        ),
      }
    case 'currencies':
      return {
        ...form,
        items: mapConditions(form.items, (condition) => settleSavedAmounts(condition, action.currencies)),
      }
    case 'move':
      if (action.groupKey === null) return { ...form, items: moveWithin(form.items, action.from, action.to) }
      return {
        ...form,
        items: form.items.map((item) =>
          item.kind === 'group' && item.key === action.groupKey
            ? { ...item, conditions: moveWithin(item.conditions, action.from, action.to) }
            : item,
        ),
      }
    case 'merchant':
      return { ...form, merchant: action.value }
    case 'category':
      return { ...form, categoryId: action.value }
    case 'tags':
      return { ...form, tags: action.value }
  }
}

/** How many conditions a rule holds in all, those inside groups included */
export function countConditions(items: RuleItemForm[]): number {
  return items.reduce((total, item) => total + (item.kind === 'group' ? item.conditions.length : 1), 0)
}

/** Whether any condition of the rule, those inside groups included, is an amount */
export function hasAmountCondition(items: RuleItemForm[]): boolean {
  return items.some((item) => (item.kind === 'group' ? item.conditions.some(isAmount) : isAmount(item)))
}

function isAmount(condition: ConditionForm): boolean {
  return condition.attribute === 'amount'
}

/** The key a condition's problem is shown under */
export function getConditionFieldKey(key: string): RuleFieldKey {
  return `condition:${key}`
}

/** The key a group's own problem is shown under */
export function getGroupFieldKey(key: string): RuleFieldKey {
  return `group:${key}`
}

/** The key a problem with an amount condition's currency is shown under, on the currency dropdown */
export function getCurrencyFieldKey(key: string): RuleFieldKey {
  return `currency:${key}`
}

/** The id of an amount condition's currency dropdown */
export function getConditionCurrencyId(key: string): string {
  return `${getConditionControlId(key)}-currency`
}

/**
 * Which problems a change to the form makes out of date, since a refusal the server made stays on a
 * field until the field changes
 */
export function getClearedErrorKeys(action: RuleFormAction): RuleFieldKey[] {
  switch (action.type) {
    case 'name':
      return ['name']
    case 'condition':
      return [getConditionFieldKey(action.key), getCurrencyFieldKey(action.key)]
    case 'remove':
      return [
        getConditionFieldKey(action.key),
        getCurrencyFieldKey(action.key),
        getGroupFieldKey(action.key),
        'conditions',
      ]
    case 'merchant':
    case 'category':
    case 'tags':
      return ['actions']
    default:
      return ['conditions']
  }
}

/** The start of the id of every control in a condition's row */
export function getConditionBaseId(key: string): string {
  return `import-rule-condition-${key}`
}

/** The id of the control that takes focus for a condition: its value field */
export function getConditionControlId(key: string): string {
  return `${getConditionBaseId(key)}-value`
}

/** The id of the button that adds a condition to a group. A group with none takes focus there */
export function getGroupControlId(key: string): string {
  return `import-rule-group-${key}-add`
}

/**
 * Finds what is wrong with one condition, and the place that shows it. The wait for the currencies and a
 * missing currency are shown on the currency, since the amount is locked while it waits and can't take focus
 */
function validateCondition(condition: ConditionForm): { key: RuleFieldKey; message: string } | undefined {
  const problem = (message: string) => ({ key: getConditionFieldKey(condition.key), message })
  switch (condition.attribute) {
    case 'description':
    case 'note':
      if (!condition.value.trim()) return problem(MISSING_TEXT_MESSAGE)
      if (condition.value.trim().length > MAX_RULE_TEXT_LENGTH) {
        return problem(`Text must be ${MAX_RULE_TEXT_LENGTH} characters or less`)
      }
      return undefined
    case 'amount': {
      const currencyProblem = (message: string) => ({ key: getCurrencyFieldKey(condition.key), message })
      if (condition.savedMinorUnits !== null) return currencyProblem(WAITING_FOR_CURRENCIES_MESSAGE)
      if (!condition.currency) return currencyProblem('Select a currency')
      if (!condition.value.trim()) return problem('Enter an amount')
      return isValidMoneyInput(condition.value) && Number(condition.value) > 0
        ? undefined
        : problem('Amount must be greater than zero')
    }
    case 'account':
      return condition.value ? undefined : problem('Select an account')
    case 'direction':
      return undefined
  }
}

/**
 * Finds what is wrong with the rule before it is sent: a missing name, a condition with nothing to
 * match, a group with no condition, and no merchant, category or tag to set
 */
export function validateRuleForm(form: RuleForm): RuleFieldErrors {
  const errors: RuleFieldErrors = {}

  if (!form.name.trim()) errors.name = 'Name is required'
  else if (form.name.trim().length > MAX_RULE_NAME_LENGTH) {
    errors.name = `Name must be ${MAX_RULE_NAME_LENGTH} characters or less`
  }

  // How many conditions a person may hold in all is the server's to count, since it sees every rule
  if (countConditions(form.items) === 0) errors.conditions = 'Please add at least one condition'

  for (const item of form.items) {
    if (item.kind === 'group') {
      if (item.conditions.length === 0) errors[getGroupFieldKey(item.key)] = 'Please add a condition to this group'
      for (const condition of item.conditions) {
        const problem = validateCondition(condition)
        if (problem) errors[problem.key] = problem.message
      }
      continue
    }
    const problem = validateCondition(item)
    if (problem) errors[problem.key] = problem.message
  }

  if (form.tags.length > MAX_RULE_TAGS) errors.actions = `Choose at most ${MAX_RULE_TAGS} tags`
  else if (!form.merchant && !form.categoryId && form.tags.length === 0) errors.actions = MISSING_ACTIONS_MESSAGE

  return errors
}

/**
 * Lists the places a problem can be shown in the order the editor draws them. A refused save brings
 * them into view in that order
 */
export function getRuleFieldOrder(form: RuleForm): RuleFieldKey[] {
  const order: RuleFieldKey[] = ['name', 'conditions']
  for (const item of form.items) {
    if (item.kind === 'group') {
      order.push(getGroupFieldKey(item.key))
      for (const condition of item.conditions) {
        order.push(getConditionFieldKey(condition.key), getCurrencyFieldKey(condition.key))
      }
    } else {
      order.push(getConditionFieldKey(item.key), getCurrencyFieldKey(item.key))
    }
  }
  order.push('actions')
  return order
}

/** The id of the control that takes focus for each place a problem can be shown */
export function getRuleControlIds(form: RuleForm): Record<RuleFieldKey, string> {
  const ids: Record<string, string> = {
    name: RULE_MODAL_IDS.name,
    conditions: RULE_MODAL_IDS.conditionsAdd,
    actions: RULE_MODAL_IDS.merchant,
  }
  for (const item of form.items) {
    if (item.kind === 'group') {
      ids[getGroupFieldKey(item.key)] = getGroupControlId(item.key)
      for (const condition of item.conditions) {
        ids[getConditionFieldKey(condition.key)] = getConditionControlId(condition.key)
        ids[getCurrencyFieldKey(condition.key)] = getConditionCurrencyId(condition.key)
      }
    } else {
      ids[getConditionFieldKey(item.key)] = getConditionControlId(item.key)
      ids[getCurrencyFieldKey(item.key)] = getConditionCurrencyId(item.key)
    }
  }
  return ids as Record<RuleFieldKey, string>
}

function buildConditionRequest(condition: ConditionForm): ImportRuleConditionRequest {
  switch (condition.attribute) {
    case 'description':
    case 'note':
      return {
        kind: 'condition',
        attribute: condition.attribute,
        operator: condition.operator as 'contains',
        value: condition.value.trim(),
      }
    case 'amount':
      return {
        kind: 'condition',
        attribute: 'amount',
        operator: condition.operator as 'is',
        value: condition.value.trim(),
        currency: condition.currency,
      }
    case 'direction':
      return { kind: 'condition', attribute: 'direction', operator: 'is', value: condition.value as 'in' }
    case 'account':
      return {
        kind: 'condition',
        attribute: 'account',
        operator: condition.operator as 'is',
        value: condition.value,
      }
  }
}

function buildItemRequests(items: RuleItemForm[]): ImportRuleItemRequest[] {
  return items.map((item) =>
    item.kind === 'group'
      ? { kind: 'group', match: item.match, conditions: item.conditions.map(buildConditionRequest) }
      : buildConditionRequest(item),
  )
}

/**
 * Builds the body that creates the rule. Amounts stay the decimal text the money field holds
 */
export function buildRulePayload(form: RuleForm): CreateImportRulePayload {
  return {
    name: form.name.trim(),
    match: form.match,
    conditions: buildItemRequests(form.items),
    merchant_id: form.merchant?.value ?? null,
    category_id: form.categoryId || null,
    tag_ids: form.tags.map((tag) => tag.value),
  }
}

/**
 * Builds the body that saves an edited rule, holding only what differs from the rule as it was
 *
 * A rule keeping a condition on a deleted account can still be renamed, since its conditions aren't
 * sent again until one of them changes. An empty result means nothing changed
 */
export function buildRuleUpdatePayload(
  form: RuleForm,
  rule: ImportRule,
  currencies: Currency[],
): UpdateImportRulePayload {
  const next = buildRulePayload(form)
  const before = buildRulePayload(buildInitialRuleForm(rule, currencies))
  const payload: UpdateImportRulePayload = {}

  if (next.name !== before.name) payload.name = next.name
  if (next.match !== before.match) payload.match = next.match
  if (JSON.stringify(next.conditions) !== JSON.stringify(before.conditions)) payload.conditions = next.conditions
  if (next.merchant_id !== before.merchant_id) payload.merchant_id = next.merchant_id
  if (next.category_id !== before.category_id) payload.category_id = next.category_id
  if ([...next.tag_ids].sort().join() !== [...before.tag_ids].sort().join()) payload.tag_ids = next.tag_ids

  return payload
}

/**
 * Puts what the server refused on the places that show it, by each error's location in the request
 *
 * A condition's location holds the list index of its item and the tag the server used to tell a
 * condition from a group, as `["conditions", 2, "condition", "amount", "value"]`, and a condition
 * inside a group adds the group's own list, as `["conditions", 2, "group", "conditions", 0, "amount",
 * "value"]`. Errors on the merchant, category and tags land on the actions together. An error whose
 * place isn't found comes back in `unplaced`, for the editor to show beside its buttons
 */
export function getRuleServerErrors(
  fieldErrors: ApiFieldError[],
  form: RuleForm,
): { errors: RuleFieldErrors; unplaced: string[] } {
  const errors: RuleFieldErrors = {}
  const unplaced: string[] = []

  for (const { path, message } of fieldErrors) {
    const key = locateServerError(path, form)
    if (key) errors[key] ??= message
    else unplaced.push(message)
  }
  return { errors, unplaced }
}

function locateServerError(path: Array<string | number>, form: RuleForm): RuleFieldKey | undefined {
  const [first, index, tag, groupList, groupIndex] = path
  switch (first) {
    case 'name':
      return 'name'
    case 'merchant_id':
    case 'category_id':
    case 'tag_ids':
    case 'actions':
      return 'actions'
    case 'conditions': {
      if (typeof index !== 'number') return 'conditions'
      const item = form.items[index]
      if (!item) return 'conditions'
      // A refusal of the currency itself belongs on the currency dropdown, not on the amount
      const field = path[path.length - 1] === 'currency' ? getCurrencyFieldKey : getConditionFieldKey
      if (item.kind === 'condition') return field(item.key)
      const inner = tag === 'group' && groupList === 'conditions' && typeof groupIndex === 'number'
      const condition = inner ? item.conditions[groupIndex] : undefined
      return condition ? field(condition.key) : getGroupFieldKey(item.key)
    }
    default:
      return undefined
  }
}

/** Returns whether the match is one the server takes, for narrowing a dropdown's string value */
export function isRuleMatch(value: string): value is ImportRuleMatch {
  return value === 'all' || value === 'any'
}
