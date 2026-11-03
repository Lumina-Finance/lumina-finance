/**
 * Tests that the tag matching step shows each tag name against the tag it will be filed under,
 * marks a name that cannot be used as invalid, glows a row it filled in for the user to check, and
 * not on an answered row or a finished import's record
 */
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { Tag } from '@/api/tags'
import { getTooManyMappingsError, IMPORT_TAG_NAME_MAX_LENGTH, MAX_IMPORT_MAPPINGS } from '@/pages/imports/constants'
import { ImportTagMatchingStep } from '@/pages/imports/sections/ImportTagMatchingStep'
import { buildImportTagOptions } from '@/pages/imports/utils'

type Props = Parameters<typeof ImportTagMatchingStep>[0]

const TRAVEL: Tag = {
  id: 'travel',
  owner_id: 'user-1',
  group_id: null,
  name: 'Travel',
  created_at: '2026-01-01T00:00:00Z',
}

const TAG_OPTIONS = buildImportTagOptions([TRAVEL])

/** Renders the step for the given tag names, with any of its props replaced */
function render(overrides: Partial<Record<keyof Props, unknown>> = {}) {
  return renderToStaticMarkup(
    createElement(ImportTagMatchingStep, {
      index: '06',
      empty: { title: 'No tags yet', description: 'Map the column holding the tags first.' },
      importedTags: ['Trip'],
      tagMappings: {},
      tagCreateNames: {},
      setTagMappings: () => undefined,
      setTagCreateNames: () => undefined,
      matchedTagByKey: new Map(),
      tagOptions: buildImportTagOptions([]),
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

/** Returns the opening tag of the name field of the row for the given file name */
function getNameField(markup: string, source: string) {
  const field = markup.match(new RegExp(`<input[^>]*aria-label="Name for the tag created from ${source}"[^>]*>`))
  if (!field) throw new Error(`No name field for ${source}`)
  return field[0]
}

/** Returns what each row's dropdown shows as chosen, in row order */
function getChosenTargets(markup: string) {
  return [...markup.matchAll(/<button[^>]*role="combobox"[^>]*>(.*?)<\/button>/g)].map((match) =>
    match[1].replace(/<[^>]*>/g, '').trim(),
  )
}

describe('the tag matching step', () => {
  it('lists each tag name from the file with a field for the name to create', () => {
    const markup = render()

    expect(markup).toContain('Tag from file')
    expect(getNameField(markup, 'Trip')).toContain('value="Trip"')
  })

  it('says to map the tags column first when the file holds no tag names', () => {
    expect(render({ importedTags: [] })).toContain('Map the column holding the tags first.')
  })

  it('says what the flow gives when the import holds no tag, and numbers the step as the flow does', () => {
    const markup = render({
      importedTags: [],
      index: '04',
      empty: {
        title: 'No tags to match',
        description: 'No imported row carries a tag, so you can carry on to the next step.',
      },
    })

    expect(markup).toContain('No tags to match')
    expect(markup).toContain('No imported row carries a tag, so you can carry on to the next step.')
    expect(markup).toContain('04')
  })

  it('explains an import with too many different tags up front, with no retry and no table', () => {
    const tags = Array.from({ length: MAX_IMPORT_MAPPINGS + 1 }, (_, index) => `Tag ${index}`)
    const markup = render({ importedTags: tags, tagMatchesFailed: true })

    expect(markup).toContain(getTooManyMappingsError('tag', MAX_IMPORT_MAPPINGS + 1))
    expect(markup).not.toContain('could not be checked')
    expect(markup).not.toContain('Retry')
    expect(markup).not.toContain('Tag from file')
  })

  it('lists an import sitting exactly on the limit', () => {
    const tags = Array.from({ length: MAX_IMPORT_MAPPINGS }, (_, index) => `Tag ${index}`)

    expect(render({ importedTags: tags })).toContain('Tag from file')
  })

  it('says the tags could not be checked when asking failed, without claiming tags would be duplicated', () => {
    const markup = render({ tagMatchesFailed: true })

    expect(markup).toContain('Your tags could not be checked')
    expect(markup).toContain('creates a tag only where you have none')
    expect(markup).not.toContain('could create tags you already have')
  })

  it('shows a name already matching a tag as filed under it, matched in other capitals', () => {
    const markup = render({
      importedTags: ['TRAVEL'],
      matchedTagByKey: new Map([['travel', TRAVEL]]),
      tagOptions: TAG_OPTIONS,
    })

    expect(getChosenTargets(markup)).toEqual(['Travel'])
    expect(getNameField(markup, 'TRAVEL')).toContain('disabled=""')
  })

  it('shows a name nothing matches as a new tag that can be renamed', () => {
    const markup = render()

    expect(getChosenTargets(markup)).toEqual(['Create new tag'])
    expect(markup).toContain('New')
    expect(getNameField(markup, 'Trip')).not.toContain('disabled')
  })

  it('shows a skipped row as ignored, with its name field unavailable', () => {
    const skipped = render({ tagMappings: { Trip: '__skip_tag__' } })

    expect(getChosenTargets(skipped)).toEqual(['Skip'])
    expect(skipped).toContain('Ignored')
    expect(skipped).not.toContain('Skipped')
    expect(getNameField(skipped, 'Trip')).toContain('disabled=""')
    expect(render()).not.toContain('Ignored')
  })
})

describe('the name a new tag is created under', () => {
  it('is not marked invalid while it can be used', () => {
    expect(getNameField(render(), 'Trip')).not.toContain('aria-invalid')
  })

  it('is marked invalid, with its reason for screen readers, when it is blank', () => {
    const markup = render({ tagCreateNames: { Trip: '   ' } })

    expect(getNameField(markup, 'Trip')).toContain('aria-invalid="true"')
    expect(markup).toContain('Enter a name for the new tag.')
  })

  it('is marked invalid when it is longer than a tag can be named, and not at exactly that length', () => {
    const tooLong = render({ tagCreateNames: { Trip: 't'.repeat(IMPORT_TAG_NAME_MAX_LENGTH + 1) } })
    const longest = render({ tagCreateNames: { Trip: 't'.repeat(IMPORT_TAG_NAME_MAX_LENGTH) } })

    expect(getNameField(tooLong, 'Trip')).toContain('aria-invalid="true"')
    expect(tooLong).toContain(`at most ${IMPORT_TAG_NAME_MAX_LENGTH} characters`)
    expect(getNameField(longest, 'Trip')).not.toContain('aria-invalid')
  })

  it('is not marked invalid on a row that creates nothing', () => {
    const skipped = render({ tagMappings: { Trip: '__skip_tag__' }, tagCreateNames: { Trip: '' } })
    const matched = render({
      importedTags: ['TRAVEL'],
      matchedTagByKey: new Map([['travel', TRAVEL]]),
      tagOptions: TAG_OPTIONS,
      tagCreateNames: { TRAVEL: '' },
    })

    expect(getNameField(skipped, 'Trip')).not.toContain('aria-invalid')
    expect(getNameField(matched, 'TRAVEL')).not.toContain('aria-invalid')
  })
})

describe('the glow on a tag row filled in for the user', () => {
  it('shows on an unanswered row of an import still being set up', () => {
    expect(render()).toContain('import-auto-fill-field')
  })

  it('stays off a row the user answered', () => {
    const answered = render({
      importedTags: ['TRAVEL'],
      matchedTagByKey: new Map([['travel', TRAVEL]]),
      tagOptions: TAG_OPTIONS,
      tagMappings: { TRAVEL: TRAVEL.id },
    })

    expect(answered).not.toContain('import-auto-fill-field')
  })

  it('stays off a row answered by typing a corrected name', () => {
    expect(render({ tagCreateNames: { Trip: 'Travel' } })).not.toContain('import-auto-fill-field')
  })

  it('stays off the record of a finished import', () => {
    const finished = { created_tag_ids: [] }

    expect(render({ importResult: finished })).not.toContain('import-auto-fill-field')
  })

  it('stays off while the matches are still loading', () => {
    expect(render({ tagMatchesLoading: true })).not.toContain('import-auto-fill-field')
  })
})
