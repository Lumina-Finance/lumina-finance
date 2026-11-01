/**
 * Guards the transactions toolbar deciding its rows from the longest word the export button can have, so
 * Add transaction and the bulk actions sit on the same rows for Export all, Export filtered and Export
 * selected. Deciding from the word on show put Add transaction beside the controls for the short word and
 * on a row of its own for the long ones, and moved it when the word changed
 */
import { describe, expect, it } from 'vitest'
import { getDesktopToolbarLayout, getWidthAtLongest } from '@/components/filters/hooks/useDesktopToolbarLayout'

// The rest of the row at the widths drawn at 1250px selecting, and the export button at each word
const ROW_WITHOUT_EXPORT = 700
const EXPORT_WIDTH = { all: 128, filtered: 173, selected: 187 }
const SLOT_AT_LONGEST = EXPORT_WIDTH.selected

function layoutAt(toolbarWidth: number, word: keyof typeof EXPORT_WIDTH, reserve: boolean) {
  const rowWidth = ROW_WITHOUT_EXPORT + EXPORT_WIDTH[word]
  return getDesktopToolbarLayout({
    toolbarWidth,
    filterWidth: reserve ? getWidthAtLongest(rowWidth, EXPORT_WIDTH[word], SLOT_AT_LONGEST) : rowWidth,
    controlsGap: 12,
    createWidth: 176,
    toggleClearance: 0,
    stackedGroupWidth: toolbarWidth,
    actionsWidth: 160,
  })
}

describe('width counted at the longest word', () => {
  it('is the same for every word and for every width the button has eased to', () => {
    const widths = [EXPORT_WIDTH.all, 150, EXPORT_WIDTH.filtered, EXPORT_WIDTH.selected].map((slot) =>
      getWidthAtLongest(ROW_WITHOUT_EXPORT + slot, slot, SLOT_AT_LONGEST),
    )
    expect(new Set(widths)).toEqual(new Set([ROW_WITHOUT_EXPORT + SLOT_AT_LONGEST]))
  })

  it('adds nothing when the control is missing or already the longest', () => {
    expect(getWidthAtLongest(500, 0, 187)).toBe(500)
    expect(getWidthAtLongest(500, 200, 187)).toBe(500)
  })
})

describe('desktop toolbar layout', () => {
  it('moves Add transaction to its own row for the short word without the reserve, which is the bug', () => {
    // Between the room the short word needs (1016) and the room the long one needs (1075)
    const toolbarWidth = 1040
    expect(layoutAt(toolbarWidth, 'all', false).stacked).toBe(false)
    expect(layoutAt(toolbarWidth, 'selected', false).stacked).toBe(true)
  })

  it('puts Add transaction on the same row for every word with the reserve', () => {
    for (const toolbarWidth of [900, 1000, 1040, 1100, 1200, 1250, 1400]) {
      const rows = (['all', 'filtered', 'selected'] as const).map((word) => layoutAt(toolbarWidth, word, true))
      expect(new Set(rows.map((row) => JSON.stringify(row))).size, `at ${toolbarWidth}px`).toBe(1)
    }
  })

  it('wraps the bulk actions only once the create button is stacked and the group is wider than its room', () => {
    const wide = getDesktopToolbarLayout({
      toolbarWidth: 2000,
      filterWidth: 1000,
      controlsGap: 12,
      createWidth: 176,
      toggleClearance: 0,
      stackedGroupWidth: 2000,
      actionsWidth: 160,
    })
    expect(wide).toEqual({ inline: true, stacked: false, wrapped: false })
    const narrow = getDesktopToolbarLayout({
      toolbarWidth: 900,
      filterWidth: 1000,
      controlsGap: 12,
      createWidth: 176,
      toggleClearance: 0,
      stackedGroupWidth: 900,
      actionsWidth: 160,
    })
    expect(narrow).toEqual({ inline: false, stacked: true, wrapped: true })
  })

  it('never wraps when there are no bulk actions', () => {
    const layout = getDesktopToolbarLayout({
      toolbarWidth: 900,
      filterWidth: 1000,
      controlsGap: 12,
      createWidth: 176,
      toggleClearance: 0,
      stackedGroupWidth: 900,
      actionsWidth: 0,
    })
    expect(layout.wrapped).toBe(false)
  })
})
