/**
 * Tests the wrapping the modal shell relies on to hold keyboard focus inside an open dialog
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { getInitialModalFocusTarget, getNextTabStop } from '@/components/modal/focus'

describe('modal focus wrapping', () => {
  const tabStops = ['name', 'currency', 'cancel', 'submit']

  it('wraps forward from the last control to the first', () => {
    expect(getNextTabStop(tabStops, 'submit', false)).toBe('name')
    expect(getNextTabStop(tabStops, 'name', false)).toBe('currency')
  })

  it('wraps backward from the first control to the last', () => {
    expect(getNextTabStop(tabStops, 'name', true)).toBe('submit')
    expect(getNextTabStop(tabStops, 'currency', true)).toBe('name')
  })

  it('starts from either end when focus is not on a control inside the panel', () => {
    expect(getNextTabStop(tabStops, null, false)).toBe('name')
    expect(getNextTabStop(tabStops, null, true)).toBe('submit')
  })

  it('reports no destination for a panel with nothing focusable in it', () => {
    expect(getNextTabStop([], null, false)).toBeNull()
  })
})

describe('the control a dialogue opens on', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  type FakeField = { name: string; isSkipped: boolean }

  // A panel of fields in order, each either inside a part marked to be skipped or not
  function openOn(fields: FakeField[]) {
    vi.stubGlobal('window', { getComputedStyle: () => ({ display: 'block', visibility: 'visible' }) })
    const elements = fields.map(
      (field) =>
        ({
          name: field.name,
          closest: (selector: string) =>
            selector === '[data-modal-skip-initial-focus]' && field.isSkipped ? {} : null,
          getClientRects: () => [{}],
        }) as unknown as HTMLElement,
    )
    const panel = { querySelector: () => null, querySelectorAll: () => elements } as unknown as HTMLElement
    return (getInitialModalFocusTarget(panel) as unknown as { name: string }).name
  }

  it('is the first field when nothing is marked to be skipped', () => {
    expect(
      openOn([
        { name: 'account', isSkipped: false },
        { name: 'amount', isSkipped: false },
      ]),
    ).toBe('account')
  })

  it('passes over a field in a part marked to be skipped, to the next one', () => {
    expect(
      openOn([
        { name: 'account', isSkipped: true },
        { name: 'amount', isSkipped: false },
      ]),
    ).toBe('amount')
  })
})
