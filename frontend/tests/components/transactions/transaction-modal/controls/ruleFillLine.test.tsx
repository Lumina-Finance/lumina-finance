/**
 * Covers the line beneath a field of the review form that says an import rule filled it in or why one
 * could not, and the link from the form to Import rules in Settings
 *
 * These tests catch a line drawn for a field no rule filled, a line that carries the text of the wrong
 * state, and a link that replaces the form the person is filling in, or that doesn't say a new tab opens
 */
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import ImportRulesLink from '@/components/transactions/transaction-modal/controls/ImportRulesLink'
import RuleFillLine from '@/components/transactions/transaction-modal/controls/RuleFillLine'

/** The text a reader sees, without the markup around it */
const textOf = (markup: string) => markup.replace(/<[^>]+>/g, '')

describe('the line beneath a field a rule filled in', () => {
  it('shows the text it is given', () => {
    expect(
      textOf(renderToStaticMarkup(createElement(RuleFillLine, { line: { tone: 'filled', text: 'Filled in by Pay' } }))),
    ).toBe('Filled in by Pay')
    expect(
      textOf(renderToStaticMarkup(createElement(RuleFillLine, { line: { tone: 'left-out', text: 'Left out.' } }))),
    ).toBe('Left out.')
  })

  it('draws nothing for a field no rule filled', () => {
    expect(renderToStaticMarkup(createElement(RuleFillLine, { line: null }))).toBe('')
  })
})

describe('the link to Import rules in Settings', () => {
  const markup = renderToStaticMarkup(createElement(ImportRulesLink))

  it('opens Import rules in a new tab, so what is entered in the form is kept', () => {
    expect(markup).toContain('href="/settings#import-rules"')
    expect(markup).toContain('target="_blank"')
    expect(markup).toContain('rel="noopener noreferrer"')
  })

  it('says in its name that a new tab opens', () => {
    expect(textOf(markup)).toBe('Open import rules (opens in a new tab)')
  })
})
