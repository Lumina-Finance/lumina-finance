/**
 * Guards the account detail loading skeleton's shimmer against a hard-coded colour, which stays
 * bright white over the dark theme's cards because only theme tokens change between themes
 *
 * It reads the inline style on purpose, since the bug is a colour written into that style and node
 * can't resolve the token to a colour
 */
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import AccountDetailLoadingSkeleton from '@/pages/accounts/detail/components/LoadingSkeleton'

const THEMED_SHIMMER = 'linear-gradient(90deg, transparent, var(--app-hover-soft), transparent)'

/** The sweeping highlight is the only element the skeleton draws with a gradient */
function getShimmerBackgrounds(markup: string) {
  return [...markup.matchAll(/background:\s*([^;"]*linear-gradient[^;"]*)/g)].map(([, value]) => value)
}

describe('account detail loading skeleton shimmer colour', () => {
  it('draws every block sweep from the theme token', () => {
    const shimmers = getShimmerBackgrounds(renderToStaticMarkup(createElement(AccountDetailLoadingSkeleton)))

    expect(shimmers.length).toBeGreaterThan(0)
    for (const shimmer of shimmers) expect(shimmer).toBe(THEMED_SHIMMER)
  })
})
