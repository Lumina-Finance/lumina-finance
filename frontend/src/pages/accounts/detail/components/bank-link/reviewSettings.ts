import type { ReviewDecision, ReviewPreferences } from '@/api/bank-sync'

export type ReviewPreset = ReviewDecision | 'custom'

export const REVIEW_PRESET_OPTIONS = [
  { value: 'review', label: 'Review all' },
  { value: 'trust', label: 'Auto-approve all' },
  { value: 'custom', label: 'Custom' },
] as const satisfies readonly { value: ReviewPreset; label: string }[]

export const REVIEW_DECISION_OPTIONS = [
  { value: 'review', label: 'Review' },
  { value: 'trust', label: 'Auto-approve' },
] as const satisfies readonly { value: ReviewDecision; label: string }[]

/** The kinds of bank data with a choice of their own, in the order Custom lists them */
export const REVIEW_KINDS: readonly { key: keyof ReviewPreferences; label: string; description: string }[] = [
  {
    key: 'new_transactions',
    label: 'New transactions',
    description: 'Still need a merchant and category before they are added',
  },
  { key: 'corrections', label: 'Corrections', description: 'The bank changes the date, amount or description' },
  { key: 'removals', label: 'Removals', description: 'The bank reports a transaction as removed' },
]

/** The preset that sets every kind to the decision */
export function presetPreferences(decision: ReviewDecision): ReviewPreferences {
  return { new_transactions: decision, corrections: decision, removals: decision }
}

/** The preset the choices amount to: the decision every kind shares, or Custom when they differ */
export function getReviewPreset(preferences: ReviewPreferences): ReviewPreset {
  const decisions = new Set(REVIEW_KINDS.map(({ key }) => preferences[key]))
  const [only] = decisions
  return decisions.size === 1 ? only : 'custom'
}
