/**
 * Guards what a loading region clips. One that asks lets its settled content, such as a tooltip or a
 * focus ring, reach past its edges, while every other keeps clipping, since a card rounding its
 * corners relies on that
 */
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import LoadingRegion from '@/components/loading/Region'

/** The region's own opening tag */
function regionTag(markup: string): string {
  return markup.slice(0, markup.indexOf('>') + 1)
}

describe('loading region clipping', () => {
  it.each([
    ['clips content concealed while it loads', { loading: true, clipsOnlyWhileChanging: true }, true],
    ['leaves settled content free to reach past its edges once asked', { loading: false, clipsOnlyWhileChanging: true }, false],
    ['clips settled content unless asked not to', { loading: false }, true],
  ])('%s', (_, props, clips) => {
    const markup = renderToStaticMarkup(<LoadingRegion label="Loading rows" {...props}><p>Rows</p></LoadingRegion>)

    expect(regionTag(markup).includes('overflow-hidden')).toBe(clips)
  })
})
