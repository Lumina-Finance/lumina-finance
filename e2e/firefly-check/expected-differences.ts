/**
 * Where Lumina knowingly ends up different from Firefly III after an import, each with the value
 * Lumina holds and the reason. The check fails on a difference missing from here, including a
 * known one that now holds another value, and on an entry that no longer occurs, so a fixed gap
 * comes off the list rather than hiding a later regression
 */
import type { ExpectedDifference } from './compare.ts'

// Lumina records a move between two of the person's own accounts under its Transfer category
const TRANSFER_CATEGORY = 'A transfer between imported accounts is filed under Transfer, so its Firefly III category is dropped'

export const EXPECTED_DIFFERENCES: ExpectedDifference[] = [
  { kind: 'transfer-category-dropped', subject: 'Savings plan', lumina: 'Transfer', reason: TRANSFER_CATEGORY },
  { kind: 'transfer-category-dropped', subject: 'Loan payments', lumina: 'Transfer', reason: TRANSFER_CATEGORY },
  {
    kind: 'row-foreign-amount',
    subject: 'Book from the US',
    lumina: 'EUR only',
    reason: 'The import records a row in its account\'s currency only, so what it cost in the other currency is dropped',
  },
  {
    kind: 'row-tags',
    subject: '2025-06-10 Tag with a comma',
    lumina: 'a | b | plain',
    reason: 'The export joins tags with commas and escapes none, so a tag holding a comma reads back as two',
  },
]
