/**
 * Covers how a file import reads the import rules' answer: pairing it with the rows it was asked
 * for, the merchant names the rules cover, the tags a rule adds, the rows each rule changed and what
 * the check says while it runs or fails
 *
 * These tests catch an answer paired with the wrong row, a merchant name asked about although every
 * row carrying it takes a rule's merchant, or left out while one row still needs it, a tag counted
 * twice or past the most a transaction carries going unreported, a rule's row count that includes rows
 * the import left out, a check shown as finished while it runs or a failure with no retry, and a
 * failure over a changed rule that asks the user to try again above its own Try again button
 */
import { describe, expect, it } from 'vitest'
import { ApiError } from '@/api/auth'
import { ImportRulesChangedError, type ImportRuleCheck, type ImportRuleRowMatch } from '@/api/import-rules'
import {
  IMPORT_RULES_CHANGED_REASON,
  IMPORT_RULES_CHECK_FAILED_MESSAGE,
  IMPORT_RULES_LOADING_LABEL,
  MAX_IMPORT_TAGS_PER_ROW,
  getRuleCoveredMerchantsLine,
} from '@/pages/imports/constants'
import type { ImportRuleRow } from '@/pages/imports/types'
import {
  addRuleTagNames,
  countRuleRowsSent,
  getImportRuleCheckDisplay,
  getImportRuleNoticeLines,
  getRuleCoveredMerchantKeys,
  getRuleCoveredMerchants,
  getImportRulesFailureReason,
  getRuleTagCountOverLimit,
  indexImportRuleMatches,
  leaveOutCoveredNames,
} from '@/pages/imports/utils/ruleMatching'

const RULE = { id: 'rule-1', name: 'Coffee' }
const NONE: ImportRuleRowMatch = { merchant: null, category: null, tags: [], tag_count: 0 }
const WITH_MERCHANT: ImportRuleRowMatch = { ...NONE, merchant: { id: 'm-1', name: 'Cafe', rule: RULE } }

function row(id: string, description: string | null): ImportRuleRow {
  return {
    id,
    request: {
      description,
      note: null,
      amount: '-1.00',
      currency: 'CAD',
      account_id: null,
      is_transfer: false,
      tag_names: [],
    },
  }
}

function lookupOf(rows: ImportRuleRow[], matches: ImportRuleRowMatch[]) {
  return indexImportRuleMatches(rows, { rows: matches, rules: [], rules_version: 'v1' })
}

describe('indexImportRuleMatches', () => {
  it('pairs each row with its answer by position and is null before an answer', () => {
    const rows = [row('a', 'Cafe'), row('b', 'Shop')]
    expect(indexImportRuleMatches(rows, null)).toBeNull()
    expect(lookupOf(rows, [WITH_MERCHANT, NONE])?.get('a')).toBe(WITH_MERCHANT)
  })
})

describe('covered merchant names', () => {
  it('covers a name only when every row carrying it takes a rule merchant, folding capitals', () => {
    const rows = [row('a', 'Cafe'), row('b', 'CAFE'), row('c', 'Shop'), row('d', 'Shop'), row('e', null)]
    const lookup = lookupOf(rows, [WITH_MERCHANT, WITH_MERCHANT, WITH_MERCHANT, NONE, NONE])
    expect(getRuleCoveredMerchantKeys(rows, lookup)).toEqual(new Set(['cafe']))
  })

  it('covers nothing before the rules have answered', () => {
    expect(getRuleCoveredMerchantKeys([row('a', 'Cafe')], null).size).toBe(0)
  })

  it('leaves covered names out of what the step asks about', () => {
    expect(leaveOutCoveredNames(['Cafe', 'Shop'], new Set(['cafe']))).toEqual(['Shop'])
  })

  it('names the rules behind each covered name', () => {
    const rows = [row('a', 'Cafe')]
    const lookup = lookupOf(rows, [WITH_MERCHANT])
    const keys = getRuleCoveredMerchantKeys(rows, lookup)
    expect(getRuleCoveredMerchants(['Cafe', 'Shop'], rows, lookup, keys)).toEqual([
      { name: 'Cafe', ruleNames: ['Coffee'] },
    ])
  })

  it('says a single name with its rules and counts several', () => {
    expect(getRuleCoveredMerchantsLine([], 1)).toBeNull()
    expect(getRuleCoveredMerchantsLine([{ name: 'Cafe', ruleNames: ['Coffee'] }], 1)).toBe(
      'The merchant name "Cafe" isn\'t listed: the rule "Coffee" sets the merchant of its rows.',
    )
    expect(
      getRuleCoveredMerchantsLine(
        [
          { name: 'A', ruleNames: ['x'] },
          { name: 'B', ruleNames: ['y'] },
        ],
        1,
      ),
    ).toContain('2')
  })

  it('says nothing once no name is left to match, where the step shows its own message', () => {
    expect(getRuleCoveredMerchantsLine([{ name: 'Cafe', ruleNames: ['Coffee'] }], 0)).toBeNull()
  })
})

describe('tags', () => {
  it('adds a rule tag once, folding capitals', () => {
    expect(addRuleTagNames(['Food'], ['food', 'Trip'])).toEqual(['Food', 'Trip'])
  })

  it('reports a tag count past the limit and nothing at it', () => {
    expect(getRuleTagCountOverLimit({ ...NONE, tag_count: MAX_IMPORT_TAGS_PER_ROW })).toBeNull()
    expect(getRuleTagCountOverLimit({ ...NONE, tag_count: MAX_IMPORT_TAGS_PER_ROW + 1 })).toBe(
      MAX_IMPORT_TAGS_PER_ROW + 1,
    )
    expect(getRuleTagCountOverLimit(undefined)).toBeNull()
  })
})

describe('counting the rows a rule changed', () => {
  const FUEL = { id: 'rule-2', name: 'Fuel' }
  const rules = [
    { rule: RULE, row_count: 3 },
    { rule: FUEL, row_count: 1 },
  ]

  it('counts only the rows sent, once each, whichever value the rule gave', () => {
    const rows = [row('a', 'Cafe'), row('b', 'Cafe'), row('c', 'Cafe'), row('d', 'Pump')]
    const both: ImportRuleRowMatch = {
      ...WITH_MERCHANT,
      category: { id: 'c-1', name: 'Dining', rule: RULE },
    }
    const tagOnly: ImportRuleRowMatch = { ...NONE, tags: [{ id: 't-1', name: 'Gas', rule: FUEL }], tag_count: 1 }
    const lookup = lookupOf(rows, [both, WITH_MERCHANT, WITH_MERCHANT, tagOnly])

    // Row c is left out of the save, so Coffee changed two rows and not three
    const sent = rows.filter((candidate) => candidate.id !== 'c')
    expect(countRuleRowsSent(rules, sent, lookup)).toEqual([
      { rule: RULE, row_count: 2 },
      { rule: FUEL, row_count: 1 },
    ])
  })

  it('drops a rule whose rows are all left out, and keeps the order of the rules', () => {
    const rows = [row('a', 'Cafe'), row('d', 'Pump')]
    const tagOnly: ImportRuleRowMatch = { ...NONE, tags: [{ id: 't-1', name: 'Gas', rule: FUEL }], tag_count: 1 }
    const lookup = lookupOf(rows, [WITH_MERCHANT, tagOnly])
    expect(countRuleRowsSent(rules, [rows[1]], lookup)).toEqual([{ rule: FUEL, row_count: 1 }])
  })

  it('counts nothing before the rules have answered', () => {
    expect(countRuleRowsSent(rules, [row('a', 'Cafe')], null)).toEqual([])
  })
})

describe('notice and check display', () => {
  it('lists each rule with its row count', () => {
    expect(
      getImportRuleNoticeLines([
        { rule: RULE, row_count: 1 },
        { rule: { id: 'r2', name: 'Fuel' }, row_count: 3 },
      ]),
    ).toEqual(['The rule "Coffee" changed 1 row.', 'The rule "Fuel" changed 3 rows.'])
  })

  const retry = () => undefined
  const check = (status: ImportRuleCheck['status']) => ({ status, error: null, retry })

  it('holds the button while checking and keeps showing a finished check while it is held on screen', () => {
    const loading = getImportRuleCheckDisplay(check('loading'), false)
    expect(loading.notice).toEqual({ state: 'running', message: IMPORT_RULES_LOADING_LABEL })
    expect(getImportRuleCheckDisplay(check('ready'), true).state?.status).toBe('loading')
    expect(getImportRuleCheckDisplay(check('ready'), false)).toEqual({ state: null, notice: null })
  })

  it("gives the server's refusal over a changed rule the panel's own reason, which asks for no retry", () => {
    const serverSentence = 'Your import rules or the records they name changed meanwhile. Please try again.'
    expect(getImportRulesFailureReason(new ApiError(serverSentence, 409, { detail: serverSentence }))).toBe(
      IMPORT_RULES_CHANGED_REASON,
    )
    expect(getImportRulesFailureReason(new ImportRulesChangedError())).toBe(IMPORT_RULES_CHANGED_REASON)
    // Any other refusal keeps the server's reason
    expect(getImportRulesFailureReason(new ApiError('Gone', 404, { detail: 'That account is gone' }))).toBe(
      'That account is gone.',
    )
  })

  it('shows a failure at once with its message and a retry for the step', () => {
    const failed = getImportRuleCheckDisplay(check('failed'), true)
    expect(failed.notice).toEqual({ state: 'failed', message: IMPORT_RULES_CHECK_FAILED_MESSAGE })
    expect(failed.state?.status).toBe('failed')
    expect(failed.state?.onRetry).toBe(retry)
  })
})
