/**
 * Tests when an import another tab saved counts as an arrival on the Imports page, which opens the
 * setup panel and flashes the "Last import" card
 *
 * These tests catch a flash on first load or from a saved copy, one for this tab's own import, and
 * one for an import going away
 */
import { describe, expect, it } from 'vitest'
import type { LastImport } from '@/api/import-runs'
import {
  INITIAL_LAST_IMPORT_ARRIVAL,
  trackLastImportArrival,
  type LastImportArrivalTracker,
} from '@/pages/imports/utils/lastImportArrival'

function entry(id: string): LastImport {
  return {
    id,
    source: 'generic',
    file_name: `${id}.csv`,
    committed_at: '2026-10-04T12:00:00Z',
    undo_until: '2026-10-07T12:00:00Z',
    transaction_count: 3,
    account_count: 0,
    category_count: 0,
    merchant_count: 0,
    tag_count: 0,
    budget_count: 0,
  }
}

type Look = { isSettled?: boolean; entry: LastImport | null; ownRunId?: string | null }

function track(...looks: Look[]): LastImportArrivalTracker {
  return looks.reduce(
    (tracker, look) => trackLastImportArrival(tracker, { isSettled: true, ownRunId: null, ...look }),
    INITIAL_LAST_IMPORT_ARRIVAL,
  )
}

describe('last import arrival', () => {
  it('is no arrival for the import the page opens with, or for opening with none', () => {
    expect(track({ entry: entry('a') }).count).toBe(0)
    expect(track({ entry: null }).count).toBe(0)
  })

  it('ignores a saved copy shown before this visit has read the import', () => {
    const tracker = track({ isSettled: false, entry: entry('old') }, { entry: entry('a') })
    expect(tracker.count).toBe(0)
    expect(tracker.shownId).toBe('a')
  })

  it('counts an import that comes after none, and one that replaces another', () => {
    const fromNone = track({ entry: null }, { entry: entry('b') })
    expect(fromNone.count).toBe(1)
    expect(fromNone.entry?.id).toBe('b')

    const replaced = track({ entry: entry('a') }, { entry: entry('b') }, { entry: entry('c') })
    expect(replaced.count).toBe(2)
    expect(replaced.entry?.id).toBe('c')
  })

  it('does not count the same import read again', () => {
    expect(track({ entry: entry('a') }, { entry: entry('a') }, { entry: entry('a') }).count).toBe(0)
  })

  it('does not count the import this tab saved itself, and still counts the next one from elsewhere', () => {
    const own = track({ entry: null }, { entry: entry('mine'), ownRunId: 'mine' })
    expect(own.count).toBe(0)
    expect(own.shownId).toBe('mine')
    expect(trackLastImportArrival(own, { isSettled: true, entry: entry('theirs'), ownRunId: 'mine' }).count).toBe(1)
  })

  it('does not count an import going, but counts the next one after it', () => {
    const gone = track({ entry: entry('a') }, { entry: null })
    expect(gone.count).toBe(0)
    expect(gone.entry).toBeNull()
    expect(trackLastImportArrival(gone, { isSettled: true, entry: entry('b'), ownRunId: null }).count).toBe(1)
  })

  it('returns the same tracker when nothing changed', () => {
    const tracker = track({ entry: entry('a') })
    expect(trackLastImportArrival(tracker, { isSettled: true, entry: entry('a'), ownRunId: null })).toBe(tracker)
    expect(trackLastImportArrival(tracker, { isSettled: false, entry: entry('b'), ownRunId: null })).toBe(tracker)
  })
})
