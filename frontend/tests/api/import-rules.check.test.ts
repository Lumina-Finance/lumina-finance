/**
 * Covers what an import waits for before it can be saved, settled from its two reads: the count of
 * conditions the user's rules hold and what the rules give the rows
 *
 * These tests catch a user with no rules made to wait or to fail, a user with rules saved without
 * the wait, a failed count read as "no rules", and an import being saved losing the answer its
 * notice is built from
 */
import { describe, expect, it } from 'vitest'
import { getImportRuleCheck, type ImportRuleMatchesResponse } from '@/api/import-rules'

const ANSWER: ImportRuleMatchesResponse = { rows: [], rules: [], rules_version: 'v1' }

const WITH_RULES = { data: { limit: 100, used: 3 }, isError: false, error: null }
const NO_MATCHES_YET = { data: undefined, isFetching: true, isPending: true, isError: false, error: null }
const ANSWERED = { data: ANSWER, isFetching: false, isPending: false, isError: false, error: null }

function check(overrides: Partial<Parameters<typeof getImportRuleCheck>[0]> = {}) {
  return getImportRuleCheck({
    hasRows: true,
    isPaused: false,
    budget: WITH_RULES,
    matches: NO_MATCHES_YET,
    ...overrides,
  })
}

describe('what an import waits for from the rules', () => {
  it('waits for nothing while there are no rows to ask about', () => {
    expect(check({ hasRows: false }).status).toBe('idle')
  })

  it('waits for the count of conditions, and says so when it cannot be read', () => {
    const unread = { data: undefined, isError: false, error: null }

    expect(check({ budget: unread }).status).toBe('loading')
    expect(check({ budget: { ...unread, isError: true, error: new Error('down') } })).toMatchObject({
      status: 'failed',
      failedRead: 'budget',
    })
  })

  it('asks nothing and waits for nothing when the user has no rules', () => {
    const state = check({ budget: { data: { limit: 100, used: 0 }, isError: false, error: null } })

    expect(state).toMatchObject({ status: 'idle', matches: null })
  })

  it('waits while the rules answer, then hands the answer over', () => {
    expect(check().status).toBe('loading')
    expect(check({ matches: ANSWERED })).toMatchObject({ status: 'ready', matches: ANSWER })
  })

  it('waits again while an answer is being read again', () => {
    expect(check({ matches: { ...ANSWERED, isFetching: true } }).status).toBe('loading')
  })

  it('fails with the reason the rules gave, and says which read to ask again', () => {
    const error = new Error('refused')
    const state = check({ matches: { ...NO_MATCHES_YET, isFetching: false, isPending: false, isError: true, error } })

    expect(state).toMatchObject({ status: 'failed', error, failedRead: 'matches', matches: null })
  })

  it('keeps the answer an import was saved with, and waits for nothing it never asked', () => {
    expect(check({ isPaused: true, matches: ANSWERED })).toMatchObject({ status: 'ready', matches: ANSWER })
    expect(check({ isPaused: true }).status).toBe('idle')
  })
})
