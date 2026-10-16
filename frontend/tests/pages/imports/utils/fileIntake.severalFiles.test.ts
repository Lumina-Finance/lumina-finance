/**
 * Tests that an upload taking several CSV files accepts a pick or a drop of many, while one that
 * takes a single file still refuses more than one
 */
import { describe, expect, it } from 'vitest'
import {
  CSV_IMPORT_FILE_TYPE,
  selectDroppedImportFiles,
  selectImportFiles,
  SEVERAL_CSV_IMPORT_FILE_TYPE,
} from '@/pages/imports/utils'

const CSV = 'Date,Amount\n2026-09-15,-12.34\n'
const march = new File([CSV], '2024-03.csv', { type: 'text/csv' })
const april = new File([CSV], '2024-04.csv', { type: '' })

describe('selecting files for an upload that takes several', () => {
  it('accepts every file picked, in the order picked', () => {
    expect(selectImportFiles([march, april], SEVERAL_CSV_IMPORT_FILE_TYPE))
      .toEqual({ status: 'accepted', files: [march, april] })
  })

  it('refuses the whole pick when one file is not a CSV', () => {
    const notes = new File([CSV], 'notes.txt', { type: '' })

    expect(selectImportFiles([march, notes], SEVERAL_CSV_IMPORT_FILE_TYPE))
      .toEqual({ status: 'refused', reason: SEVERAL_CSV_IMPORT_FILE_TYPE.wrongTypeReason })
  })

  it('still refuses two files for an upload that takes one', () => {
    expect(selectImportFiles([march, april], CSV_IMPORT_FILE_TYPE))
      .toEqual({ status: 'refused', reason: CSV_IMPORT_FILE_TYPE.multipleFilesReason })
  })
})

describe('dropping files on an upload that takes several', () => {
  const items = [march, april].map((file) => ({ kind: 'file', getAsFile: () => file }))

  it('accepts every dropped file', () => {
    expect(selectDroppedImportFiles(items, [], SEVERAL_CSV_IMPORT_FILE_TYPE))
      .toEqual({ status: 'accepted', files: [march, april] })
  })

  it('refuses a drop holding a folder, naming folders in the reason', () => {
    const folder = { kind: 'file', getAsFile: () => march, webkitGetAsEntry: () => ({ isDirectory: true }) }

    expect(selectDroppedImportFiles([items[1], folder], [], SEVERAL_CSV_IMPORT_FILE_TYPE))
      .toEqual({ status: 'refused', reason: SEVERAL_CSV_IMPORT_FILE_TYPE.directoryDropReason })
  })
})
