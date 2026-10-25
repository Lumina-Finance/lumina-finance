/**
 * Tests that the import setup panel collapses on its own for a file on desktop alone, shows while
 * hovered, focused anywhere inside or holding a field error, an open dropdown or an open date calendar
 * there only (the last two reach it as the content hold), comes back when the files go, that
 * whatever shows it while collapsed lays it over the steps and has it take its place at once when
 * the files go, and that the caret works at every size
 */
import { describe, expect, it } from 'vitest'
import {
  INITIAL_SETUP_PANEL_STATE,
  hasOnlyAcceptedFiles,
  isSetupPanelOpen,
  reduceSetupPanel,
  type SetupPanelEvent,
  type SetupPanelState,
} from '@/pages/imports/utils/setupPanel'

function run(...events: SetupPanelEvent[]): SetupPanelState {
  return events.reduce(reduceSetupPanel, INITIAL_SETUP_PANEL_STATE)
}

const STAGED_ON_DESKTOP: SetupPanelEvent = { type: 'file-staged', isDesktop: true, isFocusInside: false }
const STAGED_ELSEWHERE: SetupPanelEvent = { type: 'file-staged', isDesktop: false, isFocusInside: false }

describe('setup panel', () => {
  it('starts open', () => {
    expect(isSetupPanelOpen(INITIAL_SETUP_PANEL_STATE, true)).toBe(true)
    expect(isSetupPanelOpen(INITIAL_SETUP_PANEL_STATE, false)).toBe(true)
  })

  it('collapses on desktop when a file arrives, shows while hovered and goes when the pointer leaves', () => {
    const collapsed = run(STAGED_ON_DESKTOP)
    expect(isSetupPanelOpen(collapsed, true)).toBe(false)

    const hovered = reduceSetupPanel(collapsed, { type: 'pointer-entered' })
    expect(isSetupPanelOpen(hovered, true)).toBe(true)
    expect(hovered.isCollapsed).toBe(true)

    expect(isSetupPanelOpen(reduceSetupPanel(hovered, { type: 'pointer-left' }), true)).toBe(false)
  })

  it('collapses at once for the pointer that chose the file, and shows again when it returns', () => {
    const collapsed = run({ type: 'pointer-entered' }, STAGED_ON_DESKTOP)
    expect(isSetupPanelOpen(collapsed, true)).toBe(false)
    expect(isSetupPanelOpen(reduceSetupPanel(collapsed, { type: 'pointer-entered' }), true)).toBe(true)
  })

  it('stays open for a file on tablet and phone, ignores hovering and collapses only by the caret', () => {
    const staged = run(STAGED_ELSEWHERE)
    expect(isSetupPanelOpen(staged, false)).toBe(true)

    const caretClosed = reduceSetupPanel(staged, { type: 'toggled' })
    expect(isSetupPanelOpen(caretClosed, false)).toBe(false)
    expect(isSetupPanelOpen(reduceSetupPanel(caretClosed, { type: 'pointer-entered' }), false)).toBe(false)
    expect(isSetupPanelOpen(reduceSetupPanel(caretClosed, { type: 'focus-entered' }), false)).toBe(false)
    expect(isSetupPanelOpen(reduceSetupPanel(caretClosed, { type: 'content-hold-changed', isHeldByContent: true }), false)).toBe(false)
    expect(isSetupPanelOpen(reduceSetupPanel(caretClosed, { type: 'toggled' }), false)).toBe(true)
  })

  it('stays showing for focus anywhere inside it when a file arrives, until focus leaves', () => {
    const staged = run({ type: 'file-staged', isDesktop: true, isFocusInside: true })
    expect(isSetupPanelOpen(staged, true)).toBe(true)
    expect(isSetupPanelOpen(reduceSetupPanel(staged, { type: 'focus-left' }), true)).toBe(false)
  })

  it('stays showing while a field in it has an error, whatever the pointer does, and goes once it is fixed', () => {
    const invalid = run(STAGED_ON_DESKTOP, { type: 'content-hold-changed', isHeldByContent: true })
    expect(isSetupPanelOpen(invalid, true)).toBe(true)
    expect(isSetupPanelOpen(reduceSetupPanel(invalid, { type: 'pointer-left' }), true)).toBe(true)
    expect(isSetupPanelOpen(reduceSetupPanel(invalid, { type: 'content-hold-changed', isHeldByContent: false }), true)).toBe(false)
  })

  it('lets the caret pin a hovered panel open, or collapse one the pointer or focus is on', () => {
    const hovered = run(STAGED_ON_DESKTOP, { type: 'pointer-entered' })
    const pinned = reduceSetupPanel(hovered, { type: 'toggled' })
    expect(pinned.isCollapsed).toBe(false)
    expect(isSetupPanelOpen(reduceSetupPanel(pinned, { type: 'pointer-left' }), true)).toBe(true)

    const pinnedByFocus = run(STAGED_ON_DESKTOP, { type: 'focus-entered' }, { type: 'toggled' })
    expect(pinnedByFocus.isCollapsed).toBe(false)
    expect(isSetupPanelOpen(reduceSetupPanel(pinnedByFocus, { type: 'toggled' }), true)).toBe(false)
  })

  it('shows the panel again when the files go', () => {
    const cleared = reduceSetupPanel(run(STAGED_ON_DESKTOP), { type: 'files-cleared', isDesktop: true })
    expect(isSetupPanelOpen(cleared, true)).toBe(true)
  })
})

describe('setup panel placement', () => {
  // The page lays the steps out around the panel by whether it is collapsed alone, so a panel that
  // something shows while collapsed lies over the steps and leaves them where they are
  it('stays collapsed, and so over the steps, while the pointer, focus or a field that needs the user shows it', () => {
    const collapsed = run(STAGED_ON_DESKTOP)
    const events: SetupPanelEvent[] = [
      { type: 'pointer-entered' },
      { type: 'focus-entered' },
      { type: 'content-hold-changed', isHeldByContent: true },
    ]
    expect(events.map((event) => {
      const shown = reduceSetupPanel(collapsed, event)
      return [isSetupPanelOpen(shown, true), shown.isCollapsed]
    })).toEqual([[true, true], [true, true], [true, true]])
  })

  it('takes its place in the layout at once when the files go while something shows it over the steps', () => {
    const collapsed = run(STAGED_ON_DESKTOP)
    const events: SetupPanelEvent[] = [
      { type: 'pointer-entered' },
      { type: 'focus-entered' },
      { type: 'content-hold-changed', isHeldByContent: true },
    ]
    expect(events.map((event) => reduceSetupPanel(reduceSetupPanel(collapsed, event), { type: 'files-cleared', isDesktop: true }).isPlacedAtOnce)).toEqual([true, true, true])
  })

  it('slides into place instead when nothing shows the panel, or when it already was in place', () => {
    const cleared = (state: SetupPanelState) => reduceSetupPanel(state, { type: 'files-cleared', isDesktop: true })
    expect(cleared(run(STAGED_ON_DESKTOP)).isPlacedAtOnce).toBe(false)
    expect(cleared(run(STAGED_ON_DESKTOP, { type: 'pointer-entered' }, { type: 'toggled' })).isPlacedAtOnce).toBe(false)
    expect(cleared(INITIAL_SETUP_PANEL_STATE).isPlacedAtOnce).toBe(false)

    // Below desktop nothing shows a collapsed panel, so it never lies over the steps to be placed at once
    const caretClosed = run(STAGED_ELSEWHERE, { type: 'toggled' }, { type: 'pointer-entered' })
    expect(reduceSetupPanel(caretClosed, { type: 'files-cleared', isDesktop: false }).isPlacedAtOnce).toBe(false)
  })

  it('animates the next collapse and expand after one placed at once', () => {
    const placed = run(STAGED_ON_DESKTOP, { type: 'pointer-entered' }, { type: 'files-cleared', isDesktop: true })
    expect(placed.isPlacedAtOnce).toBe(true)
    expect(reduceSetupPanel(placed, STAGED_ON_DESKTOP).isPlacedAtOnce).toBe(false)
    expect(reduceSetupPanel(placed, { type: 'toggled' }).isPlacedAtOnce).toBe(false)
  })
})

describe('setup panel expanding for the page', () => {
  it('opens a panel a file collapsed, through the open state the caret sets and not the hover peek', () => {
    const expanded = run(STAGED_ON_DESKTOP, { type: 'expand-requested' })
    expect(expanded.isCollapsed).toBe(false)
    expect(isSetupPanelOpen(expanded, true)).toBe(true)

    const peeking = run(STAGED_ON_DESKTOP, { type: 'pointer-entered' })
    expect(reduceSetupPanel(peeking, { type: 'expand-requested' }).isCollapsed).toBe(false)
  })

  it('opens a panel the caret collapsed at any size, and leaves an open one as it is', () => {
    expect(run({ type: 'toggled' }, { type: 'expand-requested' }).isCollapsed).toBe(false)
    expect(reduceSetupPanel(INITIAL_SETUP_PANEL_STATE, { type: 'expand-requested' })).toBe(INITIAL_SETUP_PANEL_STATE)
  })

  it('lets the next file collapse it again', () => {
    const expanded = run(STAGED_ON_DESKTOP, { type: 'expand-requested' }, { type: 'files-cleared', isDesktop: true })
    expect(reduceSetupPanel(expanded, STAGED_ON_DESKTOP).isCollapsed).toBe(true)
  })
})

describe('hasOnlyAcceptedFiles', () => {
  it('is true for accepted files and empty slots, and false for no files or any refused one', () => {
    expect(hasOnlyAcceptedFiles([{ error: null }, null, { error: null }])).toBe(true)
    expect(hasOnlyAcceptedFiles([null, null])).toBe(false)
    expect(hasOnlyAcceptedFiles([])).toBe(false)
    expect(hasOnlyAcceptedFiles([{ error: null }, { error: 'No rows' }])).toBe(false)
  })
})
