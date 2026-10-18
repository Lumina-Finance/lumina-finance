/**
 * Guards the summary value skeleton's shimmer against a hard-coded colour, which stays bright white
 * over the dark theme's cards because only theme tokens change between themes
 *
 * It reads the inline style on purpose, since the bug is a colour written into that style and node
 * can't resolve the token to a colour
 */
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { SummaryValueSkeleton } from '@/pages/accounts/components/summary/ValueSkeleton'

const THEMED_SHIMMER = 'linear-gradient(90deg, transparent, var(--app-hover-soft), transparent)'

describe('summary value skeleton shimmer colour', () => {
  it('draws the sweep from the theme token', () => {
    const markup = renderToStaticMarkup(
      createElement(SummaryValueSkeleton, { label: 'Loading balance', className: 'h-4 w-16' }),
    )

    expect(markup).toContain(`background:${THEMED_SHIMMER}`)
  })
})
