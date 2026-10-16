/**
 * Tests which files the OFX import takes and how it says what it leaves out
 */
import { describe, expect, it } from 'vitest'
import { getOfxLeftOutNotice, OFX_IMPORT_FILE_TYPE } from '@/pages/imports/ofx/constants'

describe('the files the OFX import takes', () => {
  it.each(['statement.ofx', 'STATEMENT.OFX', 'export (1).Ofx', 'statement.qfx', 'STATEMENT.QFX'])('takes %s', (name) => {
    expect(OFX_IMPORT_FILE_TYPE.matches(new File([''], name))).toBe(true)
  })

  it.each(['statement.csv', 'statement.ofx.txt', 'statement.qfx.txt', 'ofx', 'qfx', 'ofx.zip', 'statement.ofxx', 'statement.qfxx'])('does not take %s', (name) => {
    expect(OFX_IMPORT_FILE_TYPE.matches(new File([''], name))).toBe(false)
  })
})

describe('the notice for the statements left out', () => {
  it.each([
    [{ investment: 1, loan: 0 }, "1 investment statement in this file isn't imported."],
    [{ investment: 0, loan: 2 }, "2 loan statements in this file aren't imported."],
    [{ investment: 2, loan: 1 }, "2 investment statements and 1 loan statement in this file aren't imported."],
  ])('says what %o holds', (counts, notice) => {
    expect(getOfxLeftOutNotice(counts)).toBe(notice)
  })

  it('says nothing when nothing is left out', () => {
    expect(getOfxLeftOutNotice({ investment: 0, loan: 0 })).toBeNull()
  })
})
