/**
 * Covers the line under a bank row's description
 *
 * These tests catch a phrase split across two lines on a narrow row, a middle dot left at the start
 * of a wrapped line, and an empty phrase drawn as a doubled dot. Where the line wraps runs in the
 * browser, since it needs layout
 */
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { DetailPhrases } from '@/components/transactions/bank-review/DetailPhrases'
import { textOf } from './fixtures'

function render(phrases: (string | false)[]): string {
  return renderToStaticMarkup(createElement(DetailPhrases, { phrases }))
}

describe('the detail line', () => {
  it('keeps each phrase whole with the dot after it, so the line wraps only between phrases', () => {
    expect(render(['Sep 21', 'Everyday', 'Needs merchant and category'])).toBe(
      '<span class="inline-block max-w-full">Sep 21 ·</span> ' +
        '<span class="inline-block max-w-full">Everyday ·</span> ' +
        '<span class="inline-block max-w-full">Needs merchant and category</span>',
    )
  })

  it('leaves out an empty phrase without doubling a dot', () => {
    expect(textOf(render(['Sep 21', false, 'Pending']))).toBe('Sep 21 · Pending')
  })
})
