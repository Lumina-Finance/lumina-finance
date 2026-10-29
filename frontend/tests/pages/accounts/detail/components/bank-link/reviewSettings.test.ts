/**
 * Covers how Review settings names a set of choices: the preset every kind shares, or Custom
 *
 * These tests catch a mix of choices shown as Review all or Auto-approve all, which would hide the
 * rows that say what differs, and a preset that leaves one kind out
 */
import { describe, expect, it } from 'vitest'
import type { ReviewDecision, ReviewPreferences } from '@/api/bank-sync'
import { getReviewPreset, presetPreferences } from '@/pages/accounts/detail/components/bank-link/reviewSettings'

function choices(
  new_transactions: ReviewDecision,
  corrections: ReviewDecision,
  removals: ReviewDecision,
): ReviewPreferences {
  return { new_transactions, corrections, removals }
}

describe('getReviewPreset', () => {
  it('names choices that all review Review all, and choices that all auto-approve Auto-approve all', () => {
    expect(getReviewPreset(choices('review', 'review', 'review'))).toBe('review')
    expect(getReviewPreset(choices('trust', 'trust', 'trust'))).toBe('trust')
  })

  // Each kind the odd one out, which any mix of three has
  it.each([
    choices('trust', 'review', 'review'),
    choices('review', 'trust', 'review'),
    choices('review', 'review', 'trust'),
  ])('names a mix Custom: %o', (mixed) => {
    expect(getReviewPreset(mixed)).toBe('custom')
  })
})

describe('presetPreferences', () => {
  it('sets every kind to the preset', () => {
    expect(presetPreferences('trust')).toEqual(choices('trust', 'trust', 'trust'))
    expect(presetPreferences('review')).toEqual(choices('review', 'review', 'review'))
  })
})
