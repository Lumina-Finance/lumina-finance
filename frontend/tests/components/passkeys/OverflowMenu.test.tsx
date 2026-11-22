/**
 * Covers what the shared overflow menu's closed trigger gives each kind of caller: the passkey card's own
 * look and name, and a list of rows' replaced look
 *
 * These tests catch the trigger losing its name, its popup marker or its disabled state, a list's trigger
 * look not replacing the card's, and the card's look being lost for a caller that sets none. The open
 * menu, its keys, its focus and its unavailable items are browser behaviour, read in the end-to-end specs
 * of each caller
 */
import type { ReactNode } from 'react'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

// The menu draws into a portal on the page body, and markup rendered to a string has neither. The
// portal gives its children back where it stands, and the page body is a stand-in the menu only hands on
vi.mock('react-dom', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react-dom')>()),
  createPortal: (children: ReactNode) => children,
}))
vi.stubGlobal('document', { body: {} })

import { OverflowMenu } from '@/components/passkeys/OverflowMenu'

const ITEMS = [
  { label: 'Rename', onSelect: () => {} },
  { label: 'Remove', onSelect: () => {}, danger: true },
]

/** The attributes of the one button the closed menu draws */
function triggerAttributes(markup: string): string {
  return markup.match(/<button([^>]*)>/)![1]
}

describe('the overflow menu trigger', () => {
  it('names the trigger and marks it as opening a closed menu, with the passkey card look', () => {
    const attributes = triggerAttributes(
      renderToStaticMarkup(createElement(OverflowMenu, { label: 'Options for Laptop', items: ITEMS, triggerRef: { current: null } })),
    )

    expect(attributes).toContain('aria-label="Options for Laptop"')
    expect(attributes).toContain('aria-haspopup="menu"')
    expect(attributes).toContain('aria-expanded="false"')
    expect(attributes).toContain('rounded-md p-1.5')
  })

  it('holds the trigger off when the caller does, and not otherwise', () => {
    const held = triggerAttributes(
      renderToStaticMarkup(createElement(OverflowMenu, { label: 'Options for Laptop', items: ITEMS, disabled: true, triggerRef: { current: null } })),
    )
    const open = triggerAttributes(
      renderToStaticMarkup(createElement(OverflowMenu, { label: 'Options for Laptop', items: ITEMS, triggerRef: { current: null } })),
    )

    expect(held).toMatch(/\sdisabled(=""|\s|$)/)
    expect(open).not.toMatch(/\sdisabled(=""|\s|$)/)
  })

  it("replaces the card's look with the one a list of rows gives it", () => {
    const attributes = triggerAttributes(
      renderToStaticMarkup(
        createElement(OverflowMenu, {
          label: 'Actions for Market',
          items: ITEMS,
          triggerRef: { current: null },
          triggerClassName: 'app-icon-button shrink-0',
        }),
      ),
    )

    expect(attributes).toContain('class="app-icon-button shrink-0"')
    expect(attributes).not.toContain('rounded-md p-1.5')
  })
})
