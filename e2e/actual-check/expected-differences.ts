/**
 * Where Lumina knowingly ends up different from Actual after importing each budget, each with the
 * value Lumina holds and the reason. The check fails on a difference missing from here, including a
 * known one that now holds another value, and on an entry that no longer occurs, so a fixed gap
 * comes off the list rather than hiding a later regression
 *
 * The datasets date everything from the run date, so a subject naming a month is worked out from it
 */
import type { ExpectedDifference } from './compare.ts'
import { shiftMonth } from './manifest.ts'

// Actual files an opening balance under its Starting Balances income category, and Lumina writes it
// as a balance adjustment, which no budget counts
const STARTING_BALANCES: ExpectedDifference = {
  kind: 'category-not-imported',
  subject: 'Starting Balances',
  lumina: 'absent',
  reason: 'An opening balance becomes a balance adjustment, so Actual\'s Starting Balances category is not imported',
}

// The edges split whose parts no longer add up is left out whole, since which part is wrong can't be
// told, while Actual counts its parts
const UNBALANCED_SPLIT = 'The import leaves out a split whose parts don\'t add up to it, and Actual counts its parts'

export function getExpectedDifferences(budget: string, asOf: string): ExpectedDifference[] {
  const monthsBack = (count: number) => shiftMonth(asOf.slice(0, 7), -count)
  switch (budget) {
    case 'envelope':
      return [
        STARTING_BALANCES,
        {
          kind: 'budget-carryover',
          subject: 'Travel',
          lumina: 'no carryover',
          reason: 'Lumina budgets have no carryover, so what Actual carries into the next month is not imported',
        },
      ]
    case 'edges':
      return [
        STARTING_BALANCES,
        { kind: 'balance', subject: 'Checking', lumina: '9383.30', reason: UNBALANCED_SPLIT },
        { kind: 'category-month', subject: `Travel (Away) ${monthsBack(2)}`, lumina: '0.00', reason: UNBALANCED_SPLIT },
      ]
    case 'tracking':
      return [
        STARTING_BALANCES,
        {
          kind: 'budget-missing',
          subject: 'Salary',
          lumina: 'absent',
          reason: 'Lumina budgets track spending, so a tracking budget\'s income figures are not imported',
        },
      ]
    case 'yen':
      return [STARTING_BALANCES]
    default:
      throw new Error(`No expected differences recorded for the ${budget} budget`)
  }
}
