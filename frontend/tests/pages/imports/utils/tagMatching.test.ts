/**
 * Tests what the tag step sends for each tag name in a file: only the values answered differently
 * from what the commit would do without being asked, and one entry for tags differing in capitals
 */
import { describe, expect, it } from 'vitest'
import type { Tag } from '@/api/tags'
import { CREATE_TAG_VALUE, IMPORT_TAG_NAME_MAX_LENGTH, SKIP_TAG_VALUE } from '@/pages/imports/constants'
import {
  buildImportTagMappings,
  buildImportTagOptions,
  getImportedTags,
  getImportTagCreateNameError,
  getImportTagRowState,
  getPreviewTagNames,
} from '@/pages/imports/utils'
import type { ImportFileDraft } from '@/pages/imports/types'

const TRAVEL: Tag = {
  id: 'travel',
  owner_id: 'user-1',
  group_id: null,
  name: 'Travel',
  created_at: '2026-01-01T00:00:00Z',
}

const FOOD: Tag = { ...TRAVEL, id: 'food', name: 'Food' }

/**
 * Builds the answers for one tag name, with nothing else in the file
 */
function buildFor(value: string, answer: string, createName?: string, matched?: Tag) {
  return buildImportTagMappings({
    importedTags: [value],
    matchedTagByKey: matched ? new Map([[value.trim().toLowerCase(), matched]]) : new Map(),
    tagMappings: answer ? { [value]: answer } : {},
    tagCreateNames: createName === undefined ? {} : { [value]: createName },
  })
}

/**
 * Builds a file whose Tags column holds the given cells
 */
function buildFile(cells: string[]): ImportFileDraft {
  return {
    id: 'file-1',
    name: 'Chequing.csv',
    size: 128,
    headers: ['Tags'],
    hasHeaderRow: true,
    rows: cells.map((cell) => ({ Tags: cell })),
    error: null,
  }
}

describe('what the tag step sends', () => {
  it('sends nothing for a value left alone', () => {
    expect(buildFor('trvl', '').mappings).toEqual([])
  })

  it('sends nothing for a value answered with the tag it already matched', () => {
    expect(buildFor('TRAVEL', TRAVEL.id, undefined, TRAVEL).mappings).toEqual([])
  })

  it('sends nothing for a value answered create under its own spelling', () => {
    expect(buildFor('trvl', CREATE_TAG_VALUE, 'trvl').mappings).toEqual([])
  })

  it('sends a create for a value answered create under the same name in other capitals', () => {
    // No tag matches, so the commit would write the file's own capitals. Travel for TRAVEL is a correction
    expect(buildFor('TRAVEL', CREATE_TAG_VALUE, 'Travel').mappings).toEqual([
      { source: 'TRAVEL', create: { name: 'Travel' } },
    ])
  })

  it('sends a create for a name in other capitals typed on a value nobody answered', () => {
    expect(buildFor('TRAVEL', '', 'Travel').mappings).toEqual([{ source: 'TRAVEL', create: { name: 'Travel' } }])
  })

  it('sends nothing for a name typed back to the value after a correction', () => {
    expect(buildFor('TRAVEL', '', 'TRAVEL').mappings).toEqual([])
  })

  it('sends a create for a value answered create under a corrected name', () => {
    expect(buildFor('trvl', CREATE_TAG_VALUE, 'Travel').mappings).toEqual([
      { source: 'trvl', create: { name: 'Travel' } },
    ])
  })

  // The name box is open on a row nothing matched, so typing in it is answering without the dropdown
  it('sends a create for a corrected name typed on a value nobody answered', () => {
    expect(buildFor('trvl', '', 'Travel').mappings).toEqual([{ source: 'trvl', create: { name: 'Travel' } }])
  })

  it('sends a create for a value answered create although it matched a tag', () => {
    expect(buildFor('TRAVEL', CREATE_TAG_VALUE, 'TRAVEL', TRAVEL).mappings).toEqual([
      { source: 'TRAVEL', create: { name: 'TRAVEL' } },
    ])
  })

  it('sends the tag chosen for a value that matched a different one', () => {
    expect(buildFor('TRAVEL', FOOD.id, undefined, TRAVEL).mappings).toEqual([{ source: 'TRAVEL', tag_id: FOOD.id }])
  })

  it('sends a skip for a value answered skip', () => {
    expect(buildFor('trvl', SKIP_TAG_VALUE).mappings).toEqual([{ source: 'trvl', skip: true }])
  })

  it('refuses a value being created under a blank name', () => {
    const { mappings, errors } = buildFor('trvl', CREATE_TAG_VALUE, '   ')

    expect(mappings).toEqual([])
    expect(errors).toEqual(['Choose a name for the new tag "trvl".'])
  })

  it('refuses a value being created under a name longer than a tag can have, and takes one that long', () => {
    const tooLong = buildFor('trvl', CREATE_TAG_VALUE, 't'.repeat(IMPORT_TAG_NAME_MAX_LENGTH + 1))
    const longest = buildFor('trvl', CREATE_TAG_VALUE, 't'.repeat(IMPORT_TAG_NAME_MAX_LENGTH))

    expect(tooLong.mappings).toEqual([])
    expect(tooLong.errors).toEqual([`The name for the new tag "trvl" is longer than 64 characters.`])
    expect(longest.errors).toEqual([])
    expect(longest.mappings).toHaveLength(1)
  })
})

describe('what is wrong with a name a tag would be created under', () => {
  it.each([
    ['', 'Enter a name for the new tag.'],
    ['   ', 'Enter a name for the new tag.'],
    ['t'.repeat(IMPORT_TAG_NAME_MAX_LENGTH + 1), 'A tag name can have at most 64 characters.'],
    ['t'.repeat(IMPORT_TAG_NAME_MAX_LENGTH), ''],
    [' Travel ', ''],
  ])('reads %j as %j', (name, error) => {
    expect(getImportTagCreateNameError(name)).toBe(error)
  })
})

describe('the tags a previewed row carries once the tag step is answered', () => {
  const tagLabelById = new Map([
    [TRAVEL.id, 'Travel'],
    [FOOD.id, 'Food'],
  ])

  /**
   * Resolves the names of one previewed row against the given answers
   */
  function preview(rowTagNames: string[], answers: Partial<Parameters<typeof getPreviewTagNames>[1]> = {}) {
    return getPreviewTagNames(rowTagNames, {
      importedTags: rowTagNames,
      matchedTagByKey: new Map(),
      tagMappings: {},
      tagCreateNames: {},
      tagLabelById,
      ...answers,
    })
  }

  it('shows the file names as they are where nothing was answered and nothing matched', () => {
    expect(preview(['trvl', 'Zoo'])).toEqual(['trvl', 'Zoo'])
  })

  it('shows the tag a name already matches, in the capitals that tag has', () => {
    expect(preview(['TRAVEL'], { matchedTagByKey: new Map([['travel', TRAVEL]]) })).toEqual(['Travel'])
  })

  it('leaves a skipped name off the row and keeps the others', () => {
    expect(preview(['Junk', 'Zoo'], { tagMappings: { Junk: SKIP_TAG_VALUE } })).toEqual(['Zoo'])
  })

  it('shows the tag a name was pointed at in place of the file name', () => {
    expect(preview(['trvl'], { tagMappings: { trvl: FOOD.id } })).toEqual(['Food'])
  })

  it('shows the corrected name, whether answered create or typed on a row nobody answered', () => {
    expect(preview(['trvl'], { tagMappings: { trvl: CREATE_TAG_VALUE }, tagCreateNames: { trvl: 'Travel' } })).toEqual([
      'Travel',
    ])
    expect(preview(['TRAVEL'], { tagCreateNames: { TRAVEL: 'Travel' } })).toEqual(['Travel'])
  })

  it('finds the answer of a name spelled in other capitals than the one the step asks about', () => {
    expect(preview(['TRIP'], { importedTags: ['trip'], tagMappings: { trip: SKIP_TAG_VALUE } })).toEqual([])
  })

  it('shows names ending up as one tag once', () => {
    const answers = { tagMappings: { a: FOOD.id, b: FOOD.id } }

    expect(preview(['a', 'b'], answers)).toEqual(['Food'])
  })
})

describe('what one row of the tag step reads as', () => {
  it('reads as matched where the value already has a tag and nobody answered', () => {
    expect(getImportTagRowState('', TRAVEL)).toBe('matched')
  })

  it('reads as creating where nothing matched and nobody answered', () => {
    expect(getImportTagRowState('', undefined)).toBe('creating')
  })

  it('reads as skipped where the user answered skip', () => {
    expect(getImportTagRowState(SKIP_TAG_VALUE, TRAVEL)).toBe('skipped')
  })

  it('reads as chosen where the user picked a tag', () => {
    expect(getImportTagRowState(FOOD.id, TRAVEL)).toBe('chosen')
  })
})

describe('the options the tag step offers', () => {
  it('lists the two actions first and then the tags by name', () => {
    const options = buildImportTagOptions([TRAVEL, FOOD], { picked: 'Aardvark' })

    expect(options.map((option) => option.value)).toEqual([
      CREATE_TAG_VALUE,
      SKIP_TAG_VALUE,
      'picked',
      'food',
      'travel',
    ])
  })

  it('words the two actions short enough for a closed dropdown on a phone', () => {
    const [create, skip] = buildImportTagOptions([])

    expect([create.label, skip.label]).toEqual(['Create new tag', 'Skip'])
  })
})

describe('the tag names a file offers to answer', () => {
  it('asks about tags differing only in capitals once, and across cells', () => {
    const file = buildFile(['Travel, food', 'TRAVEL|Food', 'Zoo'])

    // Two entries would let one spelling be answered create and the other skip, with nothing to say
    // which answer the rows carrying either spelling take
    expect(getImportedTags([file], 'Tags')).toEqual(['food', 'Travel', 'Zoo'])
  })

  it('asks about nothing without a tags column', () => {
    expect(getImportedTags([buildFile(['Travel'])], '')).toEqual([])
  })
})
