/**
 * Tests that a QIF file from Quicken goes to the QIF import and is refused by the OFX one rather
 * than read wrongly as a statement
 */
import { describe, expect, it } from 'vitest'
import { getImportExpectations } from '@/pages/imports/expectations'
import { OFX_FORMAT } from '@/pages/imports/ofx/format'
import { readOfxFile } from '@/pages/imports/ofx/utils/readFile'
import { getQifLeftOutNotice, getQifMultipleStatementsReason } from '@/pages/imports/qif/constants'
import { getQifFixedAccountExpectations, QIF_EXPECTATIONS } from '@/pages/imports/qif/expectations'
import { QIF_FORMAT } from '@/pages/imports/qif/format'
import { IMPORT_SOURCE_LABELS } from '@/pages/imports/utils/lastImport'
import { toQifFile } from './utils/fixtures'

describe('a QIF file from Quicken', () => {
  it('is offered by the QIF import and not the OFX one', () => {
    const qif = toQifFile('', 'export.QIF')

    expect(QIF_FORMAT.fileType.matches(qif)).toBe(true)
    expect(QIF_FORMAT.files.accept).toBe('.qif')
    expect(OFX_FORMAT.fileType.matches(qif)).toBe(false)
  })

  it('is refused by the OFX reader instead of being read as a statement', async () => {
    const read = await readOfxFile(toQifFile('!Type:Bank\nD1/2/2024\nT-5.00\n^\n'), 'f')
    expect(read.status).toBe('refused')
  })

  it('asks for the reading choices, which the OFX import never does', () => {
    expect(QIF_FORMAT.reading).not.toBeNull()
    expect(OFX_FORMAT.reading).toBeNull()
  })
})

describe("the QIF import on an account's own page", () => {
  it('names the account in the files hint and says each file holds one account', () => {
    expect(QIF_FORMAT.files.getFixedAccountHint('Everyday chequing')).toBe(
      'Each file is a .qif export for Everyday chequing, holding one account.',
    )
  })

  it('says why a file of several accounts is refused there, and where to import it instead', () => {
    const reason = getQifMultipleStatementsReason(3)

    expect(QIF_FORMAT.getMultipleStatementsReason(3)).toBe(reason)
    expect(reason).toContain('This file holds 3 accounts.')
    expect(reason).toContain('Imports page in Settings')
  })

  it('has a card that names the account, keeps its other promises and says several accounts are refused', () => {
    const expectations = getQifFixedAccountExpectations('Everyday chequing')
    const sources = expectations.changes.map((change) => change.source)

    expect(expectations.intro).toBe('Each transaction in your QIF file becomes one transaction in Everyday chequing.')
    expect(expectations.deviation).toContain('The balance of Everyday chequing only changes')
    expect(sources).not.toContain('An account')
    expect(sources).toContain('A file with several accounts')
    expect(sources).toContain('A split transaction')
    expect(getImportExpectations('qif', 'Everyday chequing')).toEqual(expectations)
    expect(getImportExpectations('qif', null)).toBe(QIF_EXPECTATIONS)
  })
})

describe('the notice for the investment sections left out', () => {
  it.each([
    [
      1,
      1,
      "1 investment section in this file isn't imported: only bank, cash, credit card and other account transactions are supported.",
    ],
    [
      2,
      1,
      "2 investment sections in this file aren't imported: only bank, cash, credit card and other account transactions are supported.",
    ],
    [
      2,
      3,
      "2 investment sections in these files aren't imported: only bank, cash, credit card and other account transactions are supported.",
    ],
  ])('says what %i sections in %i files', (investment, fileCount, notice) => {
    expect(getQifLeftOutNotice({ investment }, fileCount)).toBe(notice)
    expect(QIF_FORMAT.getLeftOutNotice({ investment }, fileCount)).toBe(notice)
  })

  it('says nothing when nothing is left out', () => {
    expect(getQifLeftOutNotice({ investment: 0 }, 2)).toBeNull()
  })
})

describe('the last import card', () => {
  it('names a QIF import Quicken 3.0 (QIF)', () => {
    expect(IMPORT_SOURCE_LABELS.qif).toBe('Quicken 3.0 (QIF)')
  })
})
