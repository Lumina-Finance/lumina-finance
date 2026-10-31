/**
 * Tests that the tag matching step shows each tag name against what it will be filed under, glows a
 * row it filled in for the user to check, and not on a finished import's record
 */
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { Tag } from '@/api/tags'
import { ImportTagMatchingStep } from '@/pages/imports/sections/ImportTagMatchingStep'

type Props = Parameters<typeof ImportTagMatchingStep>[0]

const TRAVEL: Tag = {
  id: 'travel',
  owner_id: 'user-1',
  group_id: null,
  name: 'Travel',
  created_at: '2026-01-01T00:00:00Z',
}

/** Renders the step for the given tag names, with any of its props replaced */
function render(overrides: Partial<Record<keyof Props, unknown>> = {}) {
  return renderToStaticMarkup(
    createElement(ImportTagMatchingStep, {
      importedTags: ['Trip'],
      tagMappings: {},
      tagCreateNames: {},
      setTagMappings: () => undefined,
      setTagCreateNames: () => undefined,
      matchedTagByKey: new Map(),
      tagOptions: [],
      rememberPickedTag: () => undefined,
      tagSearch: '',
      setTagSearch: () => undefined,
      tagSearchLoading: false,
      hasMoreTagResults: false,
      loadMoreTagResults: () => undefined,
      tagMatchesLoading: false,
      tagMatchesFailed: false,
      refetchTagMatches: () => undefined,
      importResult: null,
      ...overrides,
    } as unknown as Props),
  )
}

describe('the tag matching step', () => {
  it('lists each tag name from the file with a field for the name to create', () => {
    const markup = render()

    expect(markup).toContain('Tag from file')
    expect(markup).toContain('Name for the tag created from Trip')
  })

  it('says to map the tags column first when the file holds no tag names', () => {
    expect(render({ importedTags: [] })).toContain('Map the column holding the tags first.')
  })

  it('says the tags could not be checked when asking failed', () => {
    expect(render({ tagMatchesFailed: true })).toContain('Your tags could not be checked')
  })

  it('shows a name already matching a tag as filed under it, matched in other capitals', () => {
    const markup = render({
      importedTags: ['TRAVEL'],
      matchedTagByKey: new Map([['travel', TRAVEL]]),
      tagOptions: [{ value: TRAVEL.id, label: 'Travel', group: 'Existing tags' }],
    })

    expect(markup).toContain('opacity-60')
  })

  it('shows a skipped row shaded and struck through with an Ignored badge, as an ignored column is', () => {
    const skipped = render({ tagMappings: { Trip: '__skip_tag__' } })

    expect(skipped).toContain('line-through')
    expect(skipped).toContain('Ignored')
    expect(skipped).not.toContain('Skipped')
    expect(skipped).toContain('Name for the tag created from Trip')
    expect(render()).not.toContain('line-through')
  })
})

describe('the glow on a tag row filled in for the user', () => {
  it('shows on an unanswered row of an import still being set up', () => {
    expect(render()).toContain('import-auto-fill-field')
  })

  it('stays off on the record of a finished import', () => {
    const finished = { created_tag_ids: [] }

    expect(render({ importResult: finished })).not.toContain('import-auto-fill-field')
  })

  it('stays off while the matches are still loading', () => {
    expect(render({ tagMatchesLoading: true })).not.toContain('import-auto-fill-field')
  })
})
