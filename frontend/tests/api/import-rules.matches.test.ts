/**
 * Covers asking the user's rules about the rows of a file import: the rows go in parts that each
 * fit the row count and body size, one request after another, the answer holds one entry per row in
 * the order sent, each rule's count adds across the parts, and parts answered from different
 * versions of the rules start the check again once and then fail it
 *
 * These tests catch a row sent past what a request may hold, a row's answer paired with another row,
 * a count counted for one part only, a check that trusts parts that disagree about the rules, and a
 * cache key that holds what a statement says
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { authenticatedFetchMock } = vi.hoisted(() => ({
  authenticatedFetchMock: vi.fn(),
}))

vi.mock('@/api/client', () => ({
  authenticatedFetch: authenticatedFetchMock,
}))

import {
  fetchImportRuleMatchesInBatches,
  getImportRuleRowsDigest,
  ImportRulesChangedError,
  mergeImportRuleMatches,
  type ImportRuleMatchesResponse,
  type ImportRuleMatchRow,
  type ImportRuleRowCount,
  type ImportRuleRowMatch,
} from '@/api/import-rules'
import { MAX_IMPORT_BATCH_BYTES, MAX_IMPORT_BATCH_ROWS, getJsonByteSize } from '@/api/shared/importBatchSize'

function buildRows(count: number, note: string | null = null): ImportRuleMatchRow[] {
  return Array.from({ length: count }, (_, index) => ({
    // Short, so a part of this many rows is closed by the row count and not by the body size
    description: `S${index}`,
    note,
    amount: '-1',
    currency: 'CAD',
    account_id: null,
    is_transfer: false,
    tag_names: ['T'],
  }))
}

const NO_MATCH: ImportRuleRowMatch = { merchant: null, category: null, tags: [], tag_count: 1 }

function answerFor(
  rows: ImportRuleMatchRow[],
  rules: ImportRuleRowCount[] = [],
  version = 'v1',
): ImportRuleMatchesResponse {
  return { rows: rows.map(() => NO_MATCH), rules, rules_version: version }
}

function count(id: string, rowCount: number): ImportRuleRowCount {
  return { rule: { id, name: `Rule ${id}` }, row_count: rowCount }
}

/** The rows each request asked about, by their descriptions */
function askedParts() {
  return authenticatedFetchMock.mock.calls.map(([, init]) =>
    (JSON.parse(init.body as string) as { rows: ImportRuleMatchRow[] }).rows.map((row) => row.description),
  )
}

function rowsOf(init: { body: string }) {
  return (JSON.parse(init.body) as { rows: ImportRuleMatchRow[] }).rows
}

describe('asking the rules about a file', () => {
  beforeEach(() => {
    authenticatedFetchMock.mockReset()
    authenticatedFetchMock.mockImplementation((_path: string, init: { body: string }) =>
      Promise.resolve(answerFor(rowsOf(init))),
    )
  })

  it('asks about a short list in one request, with every field the row carries', async () => {
    const rows = buildRows(3)
    const answer = await fetchImportRuleMatchesInBatches(rows)

    expect(authenticatedFetchMock).toHaveBeenCalledTimes(1)
    const [path, init] = authenticatedFetchMock.mock.calls[0]
    expect(path).toBe('/import-rules/matches')
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body)).toEqual({ rows })
    expect(answer.rows).toHaveLength(3)
  })

  it('asks about a long list in parts one after the other and answers for every row in the order sent', async () => {
    let running = 0
    let mostAtOnce = 0
    authenticatedFetchMock.mockImplementation(async (_path: string, init: { body: string }) => {
      running += 1
      mostAtOnce = Math.max(mostAtOnce, running)
      await Promise.resolve()
      running -= 1
      return {
        rows: rowsOf(init).map((row) => ({ ...NO_MATCH, tag_count: Number(row.description?.slice(1)) })),
        rules: [],
        rules_version: 'v1',
      }
    })

    const answer = await fetchImportRuleMatchesInBatches(buildRows(MAX_IMPORT_BATCH_ROWS * 2 + 7))

    expect(askedParts().map((part) => part.length)).toEqual([MAX_IMPORT_BATCH_ROWS, MAX_IMPORT_BATCH_ROWS, 7])
    expect(mostAtOnce).toBe(1)
    expect(answer.rows.map((row) => row.tag_count)).toEqual(
      Array.from({ length: MAX_IMPORT_BATCH_ROWS * 2 + 7 }, (_, index) => index),
    )
  })

  // Rows with long notes fit the row count long before they fit the body an import request keeps to
  it('splits a list of rows with long notes so no request is over the body size', async () => {
    await fetchImportRuleMatchesInBatches(buildRows(40, 'n'.repeat(60_000)))

    expect(authenticatedFetchMock.mock.calls.length).toBeGreaterThan(1)
    for (const [, init] of authenticatedFetchMock.mock.calls) {
      expect(getJsonByteSize(JSON.parse(init.body))).toBeLessThanOrEqual(MAX_IMPORT_BATCH_BYTES)
    }
    expect(askedParts().flat()).toEqual(buildRows(40).map((row) => row.description))
  })

  it('adds each rule across the parts and keeps the order each part listed its rules in', () => {
    const merged = mergeImportRuleMatches([
      answerFor(buildRows(1), [count('a', 2), count('c', 1)]),
      answerFor(buildRows(1), [count('b', 4), count('c', 3)]),
      answerFor(buildRows(1), [count('a', 5)]),
    ])

    const order = merged.rules.map(({ rule }) => rule.id)
    expect(Object.fromEntries(merged.rules.map(({ rule, row_count: rowCount }) => [rule.id, rowCount]))).toEqual({
      a: 7,
      b: 4,
      c: 4,
    })
    expect(order).toHaveLength(3)
    expect(order.indexOf('a')).toBeLessThan(order.indexOf('c'))
    expect(order.indexOf('b')).toBeLessThan(order.indexOf('c'))
    expect(merged.rows).toHaveLength(3)
    expect(merged.rules_version).toBe('v1')
  })

  it('starts the check again from the first part when a later part came from other rules, once', async () => {
    const versions = ['v1', 'v2', 'v2', 'v2']
    authenticatedFetchMock.mockImplementation((_path: string, init: { body: string }) =>
      Promise.resolve(answerFor(rowsOf(init), [], versions.shift())),
    )

    const answer = await fetchImportRuleMatchesInBatches(buildRows(MAX_IMPORT_BATCH_ROWS + 1))

    expect(askedParts().map((part) => part.length)).toEqual([MAX_IMPORT_BATCH_ROWS, 1, MAX_IMPORT_BATCH_ROWS, 1])
    expect(answer.rules_version).toBe('v2')
    expect(answer.rows).toHaveLength(MAX_IMPORT_BATCH_ROWS + 1)
  })

  it('fails the check when the rules change again after it started over', async () => {
    const versions = ['v1', 'v2', 'v2', 'v3']
    authenticatedFetchMock.mockImplementation((_path: string, init: { body: string }) =>
      Promise.resolve(answerFor(rowsOf(init), [], versions.shift())),
    )

    await expect(fetchImportRuleMatchesInBatches(buildRows(MAX_IMPORT_BATCH_ROWS + 1))).rejects.toBeInstanceOf(
      ImportRulesChangedError,
    )
    expect(authenticatedFetchMock).toHaveBeenCalledTimes(4)
  })
})

describe('the digest a check is cached under', () => {
  it('is the same for the same rows and changes with any field of any row', () => {
    const rows = buildRows(3, 'memo')
    const digest = getImportRuleRowsDigest(rows)

    expect(getImportRuleRowsDigest(buildRows(3, 'memo'))).toBe(digest)
    expect(getImportRuleRowsDigest(buildRows(3, 'memo!'))).not.toBe(digest)
    expect(getImportRuleRowsDigest(buildRows(2, 'memo'))).not.toBe(digest)
    expect(getImportRuleRowsDigest([rows[1], rows[0], rows[2]])).not.toBe(digest)
    expect(getImportRuleRowsDigest([{ ...rows[0], tag_names: [] }, rows[1], rows[2]])).not.toBe(digest)
    expect(getImportRuleRowsDigest([{ ...rows[0], account_id: 'account-1' }, rows[1], rows[2]])).not.toBe(digest)
  })

  it('does not hold what the rows say', () => {
    const digest = getImportRuleRowsDigest([
      { ...buildRows(1)[0], description: 'SQ *MARKET 1234', note: 'Dentist visit', tag_names: ['Review'] },
    ])

    expect(digest).not.toMatch(/market|dentist|review/i)
    expect(digest.length).toBeLessThan(40)
  })
})
