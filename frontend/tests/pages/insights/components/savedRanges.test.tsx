/**
 * Guards the saved ranges list for a range longer than the 20 years a report covers. Such a range stays
 * listed and deletable while its apply button is held off
 */
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { SavedInsightsRange } from '@/api/insights'
import { SavedRanges } from '@/pages/insights/components/SavedRanges'

function savedRange(overrides: Partial<SavedInsightsRange>): SavedInsightsRange {
  return {
    id: 'range-1',
    name: 'Long look',
    amount: 6,
    unit: 'month',
    qualifier: 'past',
    created_at: '2026-01-01T00:00:00Z',
    ...overrides,
  }
}

function drawList(ranges: SavedInsightsRange[], hasMore = false, loadingMore = false) {
  return renderToStaticMarkup(
    <SavedRanges
      savedRanges={ranges}
      savedRangesError={null}
      savedRangesFailed={false}
      hasMore={hasMore}
      loadingMore={loadingMore}
      onLoadMore={() => undefined}
      draftRangeTooLong={false}
      onSaveCurrentRange={async () => undefined}
      onApplySavedRange={() => undefined}
      onDeleteSavedRange={() => undefined}
    />,
  )
}

// The apply button for a range is the one whose text holds its name
function applyButtonOf(markup: string, name: string) {
  return (
    markup.split('<button').find((button) => button.includes(`>${name}<`) || button.includes(`${name}</span>`)) ?? ''
  )
}

describe('saved ranges list', () => {
  it('holds off the apply button of a range over 20 years and keeps its delete button', () => {
    const markup = drawList([savedRange({ amount: 30, unit: 'year' })])

    expect(applyButtonOf(markup, 'Long look')).toContain('aria-disabled="true"')
    expect(markup).toContain('aria-label="Delete Long look"')
  })

  it('leaves the apply button of a range within 20 years available', () => {
    expect(applyButtonOf(drawList([savedRange({})]), 'Long look')).not.toContain('aria-disabled="true"')
  })

  it('offers Show more only while the server holds ranges beyond the ones listed', () => {
    expect(drawList([savedRange({})], false)).not.toContain('Show more')
    expect(drawList([savedRange({})], true)).toContain('Show more')
  })

  it('holds the Show more button off while the next page is being read', () => {
    const markup = drawList([savedRange({})], true, true)

    expect(markup).toContain('Loading…')
    expect(markup).not.toContain('Show more')
  })
})
