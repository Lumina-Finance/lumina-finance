import type { BankReviewRuleFill, CategoryLeftOutReason } from '@/api/bank-sync'
import type { TransactionFormValues } from '@/components/transactions/transaction-modal/types'
import { formatList } from '@/utils/formatList'

/**
 * Fills a new bank item's form in from what the user's import rules give it
 *
 * The server only sends a category whose kind fits the bank's direction, and the form's kind and
 * direction already follow the bank's sign, so the category is set without the switch that picking one
 * of another kind by hand makes
 */
export function applyRuleFill(form: TransactionFormValues, fill: BankReviewRuleFill | null): TransactionFormValues {
  if (!fill) return form
  return {
    ...form,
    merchant_id: fill.merchant?.id ?? form.merchant_id,
    category_id: fill.category?.id ?? form.category_id,
    tag_ids: fill.tags.length > 0 ? fill.tags.map((tag) => tag.id) : form.tag_ids,
  }
}

/** What a line beneath a field says: a rule filled the field in, or couldn't and why */
export type RuleFillLine = {
  tone: 'filled' | 'left-out'
  text: string
}

export type RuleFillLines = {
  merchant: RuleFillLine | null
  category: RuleFillLine | null
  tags: RuleFillLine | null
}

// Why each category a rule gives is left out of an item, as the rest of the sentence after the colon
const CATEGORY_LEFT_OUT_REASONS: Record<CategoryLeftOutReason, string> = {
  income_for_money_out: "it's an income category and this item is money out",
  expense_for_money_in: "it's an expense category and this item is money in",
  transfer: "a rule can't fill in a transfer category",
  no_direction: "the amount doesn't say if this is money in or money out",
}

const quoted = (name: string) => `"${name}"`

function getFilledInLine(ruleNames: string[]): RuleFillLine {
  return { tone: 'filled', text: `Filled in by ${formatList(ruleNames)}` }
}

/**
 * Works out the line beneath each field of a bank item's form
 *
 * A line for a filled field is gone once the person changes that field, so it only ever describes what
 * is on screen. A category or tags the rules couldn't fill say why for as long as their field is empty
 */
export function getRuleFillLines(fill: BankReviewRuleFill | null, form: TransactionFormValues): RuleFillLines {
  const lines: RuleFillLines = { merchant: null, category: null, tags: null }
  if (!fill) return lines

  if (fill.merchant && form.merchant_id === fill.merchant.id) {
    lines.merchant = getFilledInLine([fill.merchant.rule.name])
  }

  if (fill.category && form.category_id === fill.category.id) {
    lines.category = getFilledInLine([fill.category.rule.name])
  } else if (fill.category_left_out && form.category_id === '') {
    const { rule, name, reason } = fill.category_left_out
    lines.category = {
      tone: 'left-out',
      text: `The rule ${quoted(rule.name)} didn't fill in the category ${quoted(name)}: ${CATEGORY_LEFT_OUT_REASONS[reason]}.`,
    }
  }

  const filledTagIds = fill.tags.map((tag) => tag.id)
  if (filledTagIds.length > 0 && filledTagIds.every((id) => form.tag_ids.includes(id))) {
    lines.tags = getFilledInLine([...new Set(fill.tags.map((tag) => tag.rule.name))])
  } else if (fill.tags_left_out && form.tag_ids.length === 0) {
    const { rules, count, limit } = fill.tags_left_out
    const ruleList = formatList(rules.map((rule) => quoted(rule.name)))
    lines.tags =
      rules.length === 1
        ? {
            tone: 'left-out',
            text: `The rule ${ruleList} didn't fill in any tags: it adds ${count} tags and a transaction holds at most ${limit}.`,
          }
        : {
            tone: 'left-out',
            text: `The rules ${ruleList} didn't fill in any tags: they add ${count} tags together and a transaction holds at most ${limit}.`,
          }
  }
  return lines
}
