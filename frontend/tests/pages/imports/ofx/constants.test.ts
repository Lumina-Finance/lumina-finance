/**
 * Tests which files the OFX import takes and how it says what it leaves out
 */
import { describe, expect, it } from 'vitest'
import { getOfxLeftOutNotice, OFX_IMPORT_FILE_TYPE } from '@/pages/imports/ofx/constants'
import { getDropPrompt, selectImportFiles } from '@/pages/imports/utils'

describe('the files the OFX import takes', () => {
  it.each(['statement.ofx', 'STATEMENT.OFX', 'export (1).Ofx', 'statement.qfx', 'STATEMENT.QFX'])('takes %s', (name) => {
    expect(OFX_IMPORT_FILE_TYPE.matches(new File([''], name))).toBe(true)
  })

  it.each(['statement.csv', 'statement.ofx.txt', 'statement.qfx.txt', 'ofx', 'qfx', 'ofx.zip', 'statement.ofxx', 'statement.qfxx'])('does not take %s', (name) => {
    expect(OFX_IMPORT_FILE_TYPE.matches(new File([''], name))).toBe(false)
  })
})

describe('choosing several statement files at once', () => {
  const march = new File([''], '2024-03.qfx')
  const april = new File([''], '2024-04.ofx')

  it('takes every file picked, in the order picked', () => {
    expect(selectImportFiles([march, april], OFX_IMPORT_FILE_TYPE)).toEqual({ status: 'accepted', files: [march, april] })
  })

  it('refuses the whole pick when one file is not a statement', () => {
    expect(selectImportFiles([march, new File([''], 'notes.txt')], OFX_IMPORT_FILE_TYPE))
      .toEqual({ status: 'refused', reason: OFX_IMPORT_FILE_TYPE.wrongTypeReason })
  })

  it('invites several statements while files are dragged over the card', () => {
    expect(getDropPrompt(OFX_IMPORT_FILE_TYPE)).toEqual({ title: 'Drop statements here', hint: 'Release to upload them.' })
  })
})

describe('the notice for the statements left out', () => {
  it.each([
    [1, 1, "1 investment statement in this file isn't imported: only bank, credit card and loan statements are supported."],
    [2, 1, "2 investment statements in this file aren't imported: only bank, credit card and loan statements are supported."],
    [2, 3, "2 investment statements in these files aren't imported: only bank, credit card and loan statements are supported."],
  ])('says what %i investment statements in %i files', (investment, fileCount, notice) => {
    expect(getOfxLeftOutNotice({ investment }, fileCount)).toBe(notice)
  })

  it('says nothing when nothing is left out', () => {
    expect(getOfxLeftOutNotice({ investment: 0 }, 2)).toBeNull()
  })
})
