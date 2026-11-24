/**
 * Covers what the navigation's user row shows under the user's name
 *
 * These tests catch the row drawing wording of its own under the name instead of the line from its
 * own file
 */
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { NavigationUserProfile } from '@/components/navigation/parts/UserProfile'

// A null line leaves the line from the file itself in place
const state = vi.hoisted(() => ({ line: null as string | null }))

vi.mock('@/slots/userRowLine', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/slots/userRowLine')>()
  return { UserRowLine: () => state.line ?? original.UserRowLine() }
})

function renderRow() {
  return renderToStaticMarkup(
    <NavigationUserProfile displayName="Ada Lovelace" initials="AL" logout={async () => {}} />,
  )
}

describe('NavigationUserProfile', () => {
  it('draws the name and the default line, with no plan wording', () => {
    state.line = null

    const html = renderRow()

    expect(html).toContain('Ada Lovelace')
    expect(html).toContain('Self-hosted')
    expect(html).not.toMatch(/premium|plan/i)
  })

  it("draws whatever the line's file draws, with nothing added by the row", () => {
    state.line = 'Another line'

    const html = renderRow()

    expect(html).toContain('Another line')
    expect(html).not.toContain('Self-hosted')
  })
})
