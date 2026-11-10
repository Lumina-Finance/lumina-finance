/**
 * Covers the notice the review block and the pending strip show for a bank read that failed
 *
 * These tests catch a notice that doesn't say what failed or offers no retry, and a retry that drops
 * keyboard focus while it waits. Where each section puts its notice is covered with that section
 */
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { ReadFailureNotice } from '@/components/transactions/bank-review/ReadFailureNotice'

function renderNotice(isRetrying: boolean): string {
  return renderToStaticMarkup(
    createElement(ReadFailureNotice, {
      subject: 'Pending bank transactions',
      failure: { retry: () => {}, isRetrying },
    }),
  )
}

describe('a failed bank read', () => {
  it('says what could not load, offering to try again', () => {
    expect(renderNotice(false)).toMatch(
      /role="alert"[^>]*>.*Pending bank transactions could not load\.<\/span><button[^>]*>Try again<\/button>/,
    )
  })

  it('draws the retry as an inline link, hovered by its growing underline alone and ringed like one', () => {
    const tag = renderNotice(false).match(/<button[^>]*>/)?.[0]

    expect(tag).toContain('app-inline-link')
    expect(tag).toContain('underline')
    expect(tag).not.toContain('hover:bg-')
  })

  it('says it is trying again, with the retry busy but still focusable', () => {
    const markup = renderNotice(true)

    expect(markup).toMatch(/<button[^>]*aria-disabled="true"[^>]*aria-busy="true"[^>]*>Retrying…<\/button>/)
    expect(markup).not.toMatch(/<button[^>]*\sdisabled=""[^>]*>Retrying…/)
  })
})
