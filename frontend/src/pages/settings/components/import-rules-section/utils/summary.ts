import type { Currency } from '@/api/currency'
import type { ImportRule, ImportRuleCondition } from '@/api/import-rules'
import { formatCurrency } from '@/utils/formatCurrency'

/** Characters of a typed value a sentence shows before it is cut, so one long value can't fill the row */
const MAX_SHOWN_VALUE_LENGTH = 40

const TEXT_OPERATOR_WORDS = {
  contains: 'contains',
  not_contains: "doesn't contain",
  is: 'is',
  is_not: "isn't",
  starts_with: 'starts with',
  ends_with: 'ends with',
} as const

const AMOUNT_OPERATOR_WORDS = {
  is: 'is',
  at_least: 'is at least',
  at_most: 'is at most',
} as const

function shorten(value: string): string {
  const trimmed = value.trim()
  return trimmed.length > MAX_SHOWN_VALUE_LENGTH ? `${trimmed.slice(0, MAX_SHOWN_VALUE_LENGTH).trimEnd()}…` : trimmed
}

/**
 * Words one condition as a clause that starts in lower case, so it reads on after "and" or "or"
 */
function describeCondition(condition: ImportRuleCondition, currencies: Currency[]): string {
  switch (condition.attribute) {
    case 'description':
    case 'note':
      return `${condition.attribute} ${TEXT_OPERATOR_WORDS[condition.operator]} "${shorten(condition.value)}"`
    case 'amount':
      return `amount ${AMOUNT_OPERATOR_WORDS[condition.operator]} ${formatCurrency(condition.value, condition.currency, currencies)}`
    case 'direction':
      return `direction is money ${condition.value}`
    case 'account':
      if (condition.account_state === 'deleted') return 'account was deleted (never matches)'
      return `account ${condition.operator === 'is' ? 'is' : "isn't"} ${condition.account_name ?? 'an account'}`
  }
}

/**
 * Words a rule's conditions as one sentence, such as `Description contains "Market" and amount is at
 * least $12.50`
 *
 * A group is put in brackets and joined by its own All or Any, and a condition on a deleted account
 * says its account was deleted. Typed values are cut at 40 characters
 *
 * @param currencies - The currencies, for the decimal places an amount is shown with
 */
export function getRuleSummary(rule: ImportRule, currencies: Currency[]): string {
  const join = (clauses: string[], match: 'all' | 'any') => clauses.join(match === 'all' ? ' and ' : ' or ')
  const clauses = rule.conditions.map((item) =>
    item.kind === 'group'
      ? `(${join(
          item.conditions.map((condition) => describeCondition(condition, currencies)),
          item.match,
        )})`
      : describeCondition(item, currencies),
  )
  const sentence = join(clauses, rule.match)
  // The first letter and not the first character, since a rule that opens with a group opens with a bracket
  return sentence.replace(/\p{L}/u, (letter) => letter.toUpperCase())
}

/** Tags a row names before it folds the rest into a count */
export const MAX_SHOWN_TAGS = 4

/** One kind a rule sets, as a row shows it */
export type RuleSet = {
  /** The kind as the row words it: "tag" for one tag and "tags" for more */
  kind: 'merchant' | 'category' | 'tag' | 'tags'

  /** What a screen reader hears in front of each value */
  spoken: string

  /** The names shown, at most four tags */
  values: { id: string; name: string }[]

  /** Tags past the fourth, shown as a count */
  hiddenCount: number
}

/**
 * What a rule sets, one entry for each kind it sets, in the order the merchant, the category and the tags
 *
 * @param rule - The rule to describe
 */
export function getRuleSets(rule: ImportRule): RuleSet[] {
  const sets: RuleSet[] = []
  if (rule.merchant) sets.push({ kind: 'merchant', spoken: 'Sets merchant', values: [rule.merchant], hiddenCount: 0 })
  if (rule.category) sets.push({ kind: 'category', spoken: 'Sets category', values: [rule.category], hiddenCount: 0 })
  if (rule.tags.length > 0) {
    sets.push({
      kind: rule.tags.length === 1 ? 'tag' : 'tags',
      spoken: 'Adds tag',
      values: rule.tags.slice(0, MAX_SHOWN_TAGS),
      hiddenCount: Math.max(0, rule.tags.length - MAX_SHOWN_TAGS),
    })
  }
  return sets
}
