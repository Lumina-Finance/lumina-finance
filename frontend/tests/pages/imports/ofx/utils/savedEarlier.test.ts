/**
 * Tests what an OFX import says when an interrupted save had landed and the files now staged are
 * not the files that save held
 */
import { describe, expect, it } from 'vitest'
import { IMPORT_SAVED_EARLIER_MESSAGE } from '@/pages/imports/utils'
import type { OfxStagedFile } from '@/pages/imports/ofx/types'
import { describeOfxSavedEarlier } from '@/pages/imports/ofx/utils/savedEarlier'

function stagedFile(name: string, id = name): OfxStagedFile {
  return { id, name, size: 1, lastModified: 1, file: { statements: [], leftOut: { investment: 0 } } }
}

const [JAN, FEB, MAR, APR] = ['2024-01.qfx', '2024-02.qfx', '2024-03.qfx', '2024-04.qfx'].map((name) => stagedFile(name))

// Undo takes back the whole earlier import, so a file in it is reimported along with the rest
const UNDO_NOTE = 'Undo takes back the whole import, so import the files you want again afterwards.'

describe('describeOfxSavedEarlier', () => {
  it('says only that the earlier import was saved when the files are the same', () => {
    expect(describeOfxSavedEarlier([JAN, FEB], [JAN, FEB])).toBe(IMPORT_SAVED_EARLIER_MESSAGE)
  })

  it('names a file staged since, which was never imported', () => {
    expect(describeOfxSavedEarlier([JAN], [JAN, FEB])).toBe(
      `${IMPORT_SAVED_EARLIER_MESSAGE} 2024-02.qfx isn't in it, so import that file on its own.`,
    )
  })

  it('names a file removed since, and says Undo takes back the whole import', () => {
    expect(describeOfxSavedEarlier([JAN, MAR], [JAN])).toBe(
      `${IMPORT_SAVED_EARLIER_MESSAGE} 2024-03.qfx is in it. ${UNDO_NOTE}`,
    )
  })

  it('names several files of either kind in whole sentences', () => {
    expect(describeOfxSavedEarlier([JAN, MAR], [FEB, APR])).toBe(
      `${IMPORT_SAVED_EARLIER_MESSAGE} 2024-02.qfx and 2024-04.qfx aren't in it, so import those files on their own.`
      + ` 2024-01.qfx and 2024-03.qfx are in it. ${UNDO_NOTE}`,
    )
  })

  it('tells files of one name apart by their position, as the skipped table does', () => {
    const first = stagedFile('statement.qfx', 'one')
    const second = stagedFile('statement.qfx', 'two')
    const third = stagedFile('statement.qfx', 'three')

    expect(describeOfxSavedEarlier([first], [first, second, third])).toContain(
      'statement.qfx (file 2) and statement.qfx (file 3) aren\'t in it, so import those files on their own.',
    )
    expect(describeOfxSavedEarlier([first, second], [second])).toContain('statement.qfx (file 1) is in it.')
  })
})
