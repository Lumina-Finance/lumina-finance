/**
 * Tests what the tag step sends for each tag name in a file: only the values answered differently
 * from what the commit would do without being asked, and one entry for tags differing in capitals
 */
import { describe, expect, it } from 'vitest'
import { getNameKey } from '@/api/shared/nameKey'
import type { Tag } from '@/api/tags'
import { CREATE_TAG_VALUE, IMPORT_TAG_NAME_MAX_LENGTH, SKIP_TAG_VALUE } from '@/pages/imports/constants'
import {
  alignNameAnswersWithValues,
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
    matchedTagByKey: matched ? new Map([[getNameKey(value), matched]]) : new Map(),
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

  // The commit reuses the tag a created name matches whatever its capitals, so Travel typed over a
  // row matching TRAVEL files under TRAVEL
  it('shows the existing tag a created name matches rather than the capitals typed', () => {
    const upper: Tag = { ...TRAVEL, id: 'upper', name: 'TRAVEL' }
    const matchedTagByKey = new Map([['travel', upper]])

    expect(
      preview(['TRAVEL'], {
        matchedTagByKey,
        tagMappings: { TRAVEL: CREATE_TAG_VALUE },
        tagCreateNames: { TRAVEL: 'Travel' },
      }),
    ).toEqual(['TRAVEL'])
  })

  it('shows the existing tag a created name matches even when the row matched another tag', () => {
    const upper: Tag = { ...TRAVEL, id: 'upper', name: 'TRAVEL' }
    const tagLabels = new Map([[upper.id, 'TRAVEL']])

    expect(
      preview(['trvl'], {
        tagLabelById: tagLabels,
        tagMappings: { trvl: CREATE_TAG_VALUE },
        tagCreateNames: { trvl: 'Travel' },
      }),
    ).toEqual(['TRAVEL'])
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

  // The commit sees only the rows written, and a row carrying a tag over the limit is not written,
  // so a spelling only that row states is not the one the commit files the tag under. The workflow
  // leaves out rows refused for any other reason through the row filter, tested beside this file
  it('takes the spelling of a tag from the rows that will be written, not from a refused row', () => {
    const tooLong = 'x'.repeat(IMPORT_TAG_NAME_MAX_LENGTH + 1)

    expect(getImportedTags([buildFile([`TRAVEL;${tooLong}`, 'travel'])], 'Tags')).toEqual(['travel'])
  })

  it('does not ask about a short tag whose only row is refused for a long one', () => {
    const tooLong = 'x'.repeat(IMPORT_TAG_NAME_MAX_LENGTH + 1)

    expect(getImportedTags([buildFile([`Travel;${tooLong}`, 'Food'])], 'Tags')).toEqual(['Food'])
  })

  it('still asks about a tag of exactly the longest length', () => {
    const longest = 'x'.repeat(IMPORT_TAG_NAME_MAX_LENGTH)

    expect(getImportedTags([buildFile([`Travel;${longest}`])], 'Tags')).toEqual(['Travel', longest])
  })

  it('asks about nothing without a tags column', () => {
    expect(getImportedTags([buildFile(['Travel'])], '')).toEqual([])
  })

  // The browser lowers İ to i with a combining dot and the database to a plain i, so the key follows
  // the database, and a name matches the tag the commit would match
  it('asks once about a name with a dotted capital I and its plain spelling', () => {
    expect(getImportedTags([buildFile(['İstanbul', 'istanbul'])], 'Tags')).toEqual(['İstanbul'])
  })

  // The database lowers a capital sigma to the plain one wherever it stands, so a name ending in one
  // is not the name ending in the final form, which the browser would fold it to across the whole name
  it('asks separately about a name ending in a capital sigma and one ending in the final sigma', () => {
    expect(getImportedTags([buildFile(['ΟΔΟΣ', 'οδος'])], 'Tags')).toHaveLength(2)
    expect(getNameKey('ΟΔΟΣ')).toBe('οδοσ')
  })

  it('matches a name with a dotted capital I to the tag of the plain spelling', () => {
    const istanbul: Tag = { ...TRAVEL, id: 'istanbul', name: 'istanbul' }

    expect(buildFor('İSTANBUL', istanbul.id, undefined, istanbul).mappings).toEqual([])
    expect(getImportTagRowState('', istanbul)).toBe('matched')
  })
})

describe('answers to a tag spelled in other capitals once a date range leaves only one spelling', () => {
  const january = { Tags: 'Travel', Date: '2026-01-10' }
  const february = { Tags: 'travel', Date: '2026-02-10' }
  const file: ImportFileDraft = {
    ...buildFile([]),
    headers: ['Tags', 'Date'],
    rows: [january, february],
  }
  const onlyFebruary = (row: { Date?: string }) => row.Date === '2026-02-10'

  /** Builds what the step sends for the tags the rows left in range ask about, given answers held as the workflow holds them */
  function sendFor(answers: Record<string, string>, createNames: Record<string, string> = {}) {
    const importedTags = getImportedTags([file], 'Tags', onlyFebruary)
    return buildImportTagMappings({
      importedTags,
      matchedTagByKey: new Map(),
      tagMappings: alignNameAnswersWithValues(answers, importedTags),
      tagCreateNames: alignNameAnswersWithValues(createNames, importedTags),
    })
  }

  it('asks about the spelling the range leaves', () => {
    expect(getImportedTags([file], 'Tags')).toEqual(['Travel'])
    expect(getImportedTags([file], 'Tags', onlyFebruary)).toEqual(['travel'])
  })

  it('keeps a skip given to the spelling the whole file showed', () => {
    expect(sendFor({ Travel: SKIP_TAG_VALUE }).mappings).toEqual([{ source: 'travel', skip: true }])
  })

  it('keeps a corrected name given to the spelling the whole file showed', () => {
    const { mappings } = sendFor({ Travel: CREATE_TAG_VALUE }, { Travel: 'Holiday' })

    expect(mappings).toEqual([{ source: 'travel', create: { name: 'Holiday' } }])
  })

  it('prefers an answer given to the exact spelling asked about', () => {
    expect(sendFor({ Travel: SKIP_TAG_VALUE, travel: FOOD.id }).mappings).toEqual([
      { source: 'travel', tag_id: FOOD.id },
    ])
  })
})

describe('a tag name longer than a tag can be', () => {
  // Asked about, it would have the match request refused whole, and no answer to it could be sent.
  // It is listed as a row that won't import instead, and the short names on that row go with it
  it.each([IMPORT_TAG_NAME_MAX_LENGTH + 1, 257, 100_000])(
    'is not asked about at %i characters, so it fails neither the matches nor the other rows',
    (length) => {
      const file = buildFile([`Travel,${'x'.repeat(length)}`, 'y'.repeat(IMPORT_TAG_NAME_MAX_LENGTH)])

      expect(getImportedTags([file], 'Tags')).toEqual(['y'.repeat(IMPORT_TAG_NAME_MAX_LENGTH)])
    },
  )

  it('counts characters rather than UTF-16 units', () => {
    expect(getImportedTags([buildFile(['😀'.repeat(IMPORT_TAG_NAME_MAX_LENGTH)])], 'Tags')).toHaveLength(1)
  })
})

describe('moving answers onto the spelling a step asks about', () => {
  it('returns the same answers where nothing needs moving', () => {
    const answers = { Travel: SKIP_TAG_VALUE, Zoo: FOOD.id }

    expect(alignNameAnswersWithValues(answers, ['Travel', 'Zoo'])).toBe(answers)
  })

  it('moves an answer rather than copying it, and leaves answers for names no longer asked about', () => {
    expect(alignNameAnswersWithValues({ Travel: SKIP_TAG_VALUE, Zoo: FOOD.id }, ['travel'])).toEqual({
      travel: SKIP_TAG_VALUE,
      Zoo: FOOD.id,
    })
  })
})
