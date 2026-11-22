/**
 * Covers what a rule's row says to a screen reader, so a rewrite can't drop the rule's name or sentence
 * from the button that opens it, or leave the menu and the delete answers with no name. The menu itself
 * opens only in a browser, so its items and keys are read in the end-to-end spec
 *
 * The markup is read for words and attributes, never class names
 */
import { createElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import type { Currency } from '@/api/currency'
import type { ImportRule } from '@/api/import-rules'

// The row's menu draws into a portal on the page body, and markup rendered to a string has neither. The
// portal gives its children back where it stands, and the page body is a stand-in the menu only hands on
vi.mock('react-dom', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react-dom')>()),
  createPortal: (children: ReactNode) => children,
}))
vi.stubGlobal('document', { body: {} })

// The spinner measures the window to crossfade, and markup rendered alone has no window
vi.mock('@/components/loading/PendingLabel', () => ({
  PendingLabel: ({ children }: { children: unknown }) => children,
}))

import { RuleRow } from '@/pages/settings/components/import-rules-section/list/Row'

const CURRENCIES: Currency[] = [{ id: 'CAD', name: 'Canadian dollar', symbol: '$', minor_unit_exponent: 2 }]

const RULE: ImportRule = {
  id: 'rule-1',
  name: 'Market',
  position: 0,
  match: 'all',
  conditions: [{ kind: 'condition', attribute: 'description', operator: 'contains', value: 'GROCER' }],
  merchant: { id: 'm1', name: 'Corner Market' },
  category: { id: 'c1', name: 'Groceries' },
  tags: [
    { id: 't1', name: 'food' },
    { id: 't2', name: 'weekly' },
  ],
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
}

function renderRow(overrides: Partial<Parameters<typeof RuleRow>[0]> = {}) {
  return renderToStaticMarkup(
    createElement(RuleRow, {
      rule: RULE,
      currencies: CURRENCIES,
      grip: createElement('button', { 'aria-label': 'Move Market' }),
      isLast: false,
      moveUp: { position: null, reason: 'This rule is already first' },
      moveDown: { position: 1, reason: null },
      movingReason: null,
      confirmingDelete: false,
      deleting: false,
      onEdit: () => {},
      onMoveUp: () => {},
      onMoveDown: () => {},
      onDeleteRequest: () => {},
      onDeleteCancel: () => {},
      onDeleteConfirm: () => {},
      ...overrides,
    }),
  )
}

describe('a rule row', () => {
  it('puts the name, the sentence and each result in the one button that opens the editor', () => {
    const markup = renderRow()
    const editor = markup
      .match(/<button type="button"[^>]*>([\s\S]*?)<\/button>/g)
      ?.find((button) => button.includes('Market'))

    expect(editor).toContain('Market')
    expect(editor).toContain('Description contains &quot;GROCER&quot;')
    expect(editor).toContain('Corner Market')
    expect(editor).toContain('Groceries')
    expect(editor).toContain('food')
    expect(editor).toContain('weekly')
  })

  it('draws the sentence as text that rests still, and slides only while the button that opens the rule is hovered or focused', () => {
    const markup = renderRow()
    const sentence = markup.match(/<span class="app-marquee-text[^"]*"[^>]*>([\s\S]*?)<\/span><\/span>/)?.[0]
    const editor = markup.match(/<button type="button" class="[^"]*"[^>]*>/)?.[0]

    expect(sentence).toContain('Description contains &quot;GROCER&quot;')
    // Never driven by the row's own state, so a long sentence is never moving by itself
    expect(sentence).toContain('data-active="false"')
    expect(editor).toContain('app-marquee-trigger')
  })

  it('says what each result sets to a screen reader, so a result is never a bare word', () => {
    const markup = renderRow()

    expect(markup).toContain('Sets merchant')
    expect(markup).toContain('Sets category')
    expect(markup).toContain('Adds tag')
  })

  it('draws the kind of each result and the When and Sets labels for the eye alone, so a screen reader never hears them twice', () => {
    const markup = renderRow()

    for (const label of ['When', 'Sets', 'merchant', 'category', 'tags']) {
      expect(markup, label).toMatch(new RegExp(`aria-hidden="true"[^>]*>${label}</span>`))
    }
  })

  it('calls one tag a tag and puts a comma between the kinds and between the tags', () => {
    const one = renderRow({ rule: { ...RULE, merchant: null, category: null, tags: [RULE.tags[0]] } })
    const several = renderRow()

    expect(one).toMatch(/aria-hidden="true"[^>]*>tag<\/span>/)
    expect(one).not.toMatch(/aria-hidden="true"[^>]*>tags<\/span>/)
    expect(several).toContain('food, <span class="sr-only">Adds tag </span>weekly')
    expect(several).toMatch(/aria-hidden="true" class="min-\[750px\]:hidden">, <\/span>/)
  })

  it('leaves no pills behind', () => {
    expect(renderRow()).not.toContain('rounded-md')
  })

  it('folds tags past the fourth into a count a screen reader reads as tags', () => {
    const tags = Array.from({ length: 6 }, (_, index) => ({ id: `t${index}`, name: `tag-${index}` }))
    const markup = renderRow({ rule: { ...RULE, tags } })

    expect(markup).toContain('tag-3')
    expect(markup).not.toContain('tag-4')
    expect(markup).toContain('+2')
    expect(markup).toContain('more tags')
  })

  it('names the menu after the rule', () => {
    expect(renderRow()).toContain('aria-label="Actions for Market"')
  })

  it('swaps the menu for a named Cancel and Confirm while a delete is asked', () => {
    const markup = renderRow({ confirmingDelete: true })

    expect(markup).toContain('aria-label="Cancel deleting Market"')
    expect(markup).toContain('aria-label="Confirm delete Market"')
    expect(markup).not.toContain('Actions for Market')
  })

  it('holds the row from opening while its delete is on its way', () => {
    const markup = renderRow({ confirmingDelete: true, deleting: true })
    const editor = markup.match(
      /<button type="button"[^>]*>(?:(?!<\/button>)[\s\S])*Corner Market[\s\S]*?<\/button>/,
    )?.[0]

    expect(editor).toContain('disabled')
  })
})
