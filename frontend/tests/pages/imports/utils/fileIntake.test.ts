/**
 * Tests the shared import file selection and reader orchestration boundary
 */
import { describe, expect, it, vi } from 'vitest'
import {
  MAX_IMPORT_FILE_BYTES,
  processImportFileIntake,
  readCsvFile,
  selectDroppedImportFile,
  selectDroppedImportFiles,
} from '@/pages/imports/utils'

const VALID_CSV = 'Date,Amount\n2026-09-15,-12.34\n'
const SUPPORTED_CURRENCY_CODES = new Set(['CAD'])

describe('processing an acquired import file', () => {
  it('passes one CSV file unchanged to the existing reader', async () => {
    const file = new File([VALID_CSV], 'statement.csv', { type: '' })
    const readFile = vi.fn((selectedFile: File) => (
      readCsvFile(selectedFile, SUPPORTED_CURRENCY_CODES, { requireDataRows: true })
    ))

    const result = await processImportFileIntake({
      files: [file],
      processing: false,
      unavailableReason: null,
      readFile,
    })

    expect(readFile).toHaveBeenCalledOnce()
    expect(readFile).toHaveBeenCalledWith(file)
    expect(result.status).toBe('accepted')
    if (result.status !== 'accepted') return
    expect(result.result.error).toBeNull()
    expect(result.result.rows).toEqual([{ Date: '2026-09-15', Amount: '-12.34' }])
  })

  it('refuses readable CSV text labelled as an image before invoking the reader', async () => {
    const file = new File([VALID_CSV], 'image.png', { type: 'image/png' })
    const readFile = vi.fn((selectedFile: File) => (
      readCsvFile(selectedFile, SUPPORTED_CURRENCY_CODES, { requireDataRows: true })
    ))

    const result = await processImportFileIntake({
      files: [file],
      processing: false,
      unavailableReason: null,
      readFile,
    })

    expect(result).toEqual({ status: 'refused', reason: 'Choose a CSV file.' })
    expect(readFile).not.toHaveBeenCalled()
  })

  it('treats an empty selection as cancellation without invoking the reader', async () => {
    const readFile = vi.fn(async () => 'read')

    expect(await processImportFileIntake({
      files: [],
      processing: false,
      unavailableReason: null,
      readFile,
    })).toEqual({ status: 'cancelled' })
    expect(readFile).not.toHaveBeenCalled()
  })

  it.each([
    ['normalized CSV MIME', new File([VALID_CSV], 'report.txt', { type: '  TEXT/CSV  ' })],
    ['upper-case extension', new File([VALID_CSV], 'STATEMENT.CSV', { type: '' })],
    ['CSV extension with image MIME', new File([VALID_CSV], 'statement.csv', { type: 'image/png' })],
    ['CSV MIME without a CSV extension', new File([VALID_CSV], 'report.data', { type: 'text/csv' })],
  ])('accepts one file identified by %s', async (_label, file) => {
    const readFile = vi.fn(async (selectedFile: File) => selectedFile)

    expect(await processImportFileIntake({
      files: [file],
      processing: false,
      unavailableReason: null,
      readFile,
    })).toEqual({ status: 'accepted', result: file })
    expect(readFile).toHaveBeenCalledOnce()
    expect(readFile).toHaveBeenCalledWith(file)
  })

  it('refuses two files together without reading either one', async () => {
    const first = new File([VALID_CSV], 'first.csv', { type: 'text/csv' })
    const second = new File([VALID_CSV], 'second.csv', { type: 'text/csv' })
    const files = [first, second]
    const originalFiles = [...files]
    const readFile = vi.fn(async () => 'read')

    expect(await processImportFileIntake({
      files,
      processing: false,
      unavailableReason: null,
      readFile,
    })).toEqual({ status: 'refused', reason: 'Choose one CSV file at a time.' })
    expect(readFile).not.toHaveBeenCalled()
    expect(files).toEqual(originalFiles)
    expect(files[0]).toBe(first)
    expect(files[1]).toBe(second)
  })

  it('refuses an empty-MIME non-CSV file before invoking the reader', async () => {
    const file = new File([VALID_CSV], 'notes.txt', { type: '' })
    const readFile = vi.fn(async () => 'read')

    expect(await processImportFileIntake({
      files: [file],
      processing: false,
      unavailableReason: null,
      readFile,
    })).toEqual({ status: 'refused', reason: 'Choose a CSV file.' })
    expect(readFile).not.toHaveBeenCalled()
  })

  it('returns the existing upload block without invoking the selector reader', async () => {
    const readFile = vi.fn(async () => 'read')

    expect(await processImportFileIntake({
      files: [new File([VALID_CSV], 'statement.csv')],
      processing: false,
      unavailableReason: 'Currencies are still loading.',
      readFile,
    })).toEqual({ status: 'unavailable', reason: 'Currencies are still loading.' })
    expect(readFile).not.toHaveBeenCalled()
  })

  it('returns the processing state without invoking the selector reader', async () => {
    const readFile = vi.fn(async () => 'read')

    expect(await processImportFileIntake({
      files: [new File([VALID_CSV], 'statement.csv')],
      processing: true,
      unavailableReason: null,
      readFile,
    })).toEqual({ status: 'processing' })
    expect(readFile).not.toHaveBeenCalled()
  })

  it('keeps the existing upload block ahead of the processing state', async () => {
    const readFile = vi.fn(async () => 'read')

    expect(await processImportFileIntake({
      files: [new File([VALID_CSV], 'statement.csv')],
      processing: true,
      unavailableReason: 'Currencies could not be loaded.',
      readFile,
    })).toEqual({ status: 'unavailable', reason: 'Currencies could not be loaded.' })
    expect(readFile).not.toHaveBeenCalled()
  })

  it('leaves an accepted oversize CSV to the existing reader limit', async () => {
    const file = new File([VALID_CSV], 'statement.csv', { type: 'text/csv' })
    Object.defineProperty(file, 'size', { value: MAX_IMPORT_FILE_BYTES + 1 })
    const readText = vi.spyOn(file, 'text')

    const result = await processImportFileIntake({
      files: [file],
      processing: false,
      unavailableReason: null,
      readFile: (selectedFile) => (
        readCsvFile(selectedFile, SUPPORTED_CURRENCY_CODES, { requireDataRows: true })
      ),
    })

    expect(result.status).toBe('accepted')
    if (result.status !== 'accepted') return
    expect(result.result.error).toContain('reads files up to')
    expect(readText).not.toHaveBeenCalled()
  })
})

describe('acquiring a dropped import item', () => {
  it('passes an aggregate dropped-file selection through the intake reader', async () => {
    const file = new File([VALID_CSV], 'statement.csv', { type: 'text/csv' })
    const selection = selectDroppedImportFiles([{ kind: 'file', getAsFile: () => file }], [])
    const readFile = vi.fn(async (selectedFile: File) => selectedFile)

    expect(await processImportFileIntake({
      files: selection,
      processing: false,
      unavailableReason: null,
      readFile,
    })).toEqual({ status: 'accepted', result: file })
    expect(readFile).toHaveBeenCalledWith(file)
  })

  it('passes an aggregate multiple-item refusal through without acquiring either file', async () => {
    const getFirstFile = vi.fn(() => new File([VALID_CSV], 'first.csv'))
    const getSecondFile = vi.fn(() => new File([VALID_CSV], 'second.csv'))
    const selection = selectDroppedImportFiles([
      { kind: 'file', getAsFile: getFirstFile },
      { kind: 'file', getAsFile: getSecondFile },
    ], [])
    const readFile = vi.fn(async () => 'read')

    expect(await processImportFileIntake({
      files: selection,
      processing: false,
      unavailableReason: null,
      readFile,
    })).toEqual({ status: 'refused', reason: 'Choose one CSV file at a time.' })
    expect(getFirstFile).not.toHaveBeenCalled()
    expect(getSecondFile).not.toHaveBeenCalled()
    expect(readFile).not.toHaveBeenCalled()
  })

  it.each([
    ['file then text', true, 'string', 'Drop a CSV file, not text or other page content.'],
    ['text then file', false, 'string', 'Drop a CSV file, not text or other page content.'],
    ['file then directory', true, 'directory', 'Folders cannot be uploaded. Choose one CSV file.'],
    ['directory then file', false, 'directory', 'Folders cannot be uploaded. Choose one CSV file.'],
  ] as const)('keeps the specific refusal for an aggregate %s drop', async (
    _label,
    fileFirst,
    extraKind,
    expectedReason,
  ) => {
    const getCsvFile = vi.fn(() => new File([VALID_CSV], 'statement.csv', { type: 'text/csv' }))
    const getExtraFile = vi.fn(() => new File([VALID_CSV], 'folder.csv'))
    const getDirectoryEntry = vi.fn(() => ({ isDirectory: true }))
    const csvItem = { kind: 'file', getAsFile: getCsvFile }
    const extraItem = extraKind === 'string'
      ? { kind: 'string', getAsFile: getExtraFile }
      : { kind: 'file', getAsFile: getExtraFile, webkitGetAsEntry: getDirectoryEntry }
    const selection = selectDroppedImportFiles(
      fileFirst ? [csvItem, extraItem] : [extraItem, csvItem],
      [],
    )
    const readFile = vi.fn(async () => 'read')

    expect(await processImportFileIntake({
      files: selection,
      processing: false,
      unavailableReason: null,
      readFile,
    })).toEqual({ status: 'refused', reason: expectedReason })
    expect(getCsvFile).not.toHaveBeenCalled()
    expect(getExtraFile).not.toHaveBeenCalled()
    expect(readFile).not.toHaveBeenCalled()
  })

  it('returns the same file from a dropped file item', () => {
    const file = new File([VALID_CSV], 'statement.csv', { type: 'text/csv' })
    const getAsFile = vi.fn(() => file)

    expect(selectDroppedImportFile({ kind: 'file', getAsFile })).toEqual({ status: 'accepted', file })
    expect(getAsFile).toHaveBeenCalledOnce()
  })

  it('refuses dropped text without asking it for a file', () => {
    const getAsFile = vi.fn(() => null)

    expect(selectDroppedImportFile({ kind: 'string', getAsFile })).toEqual({
      status: 'refused',
      reason: 'Drop a CSV file, not text or other page content.',
    })
    expect(getAsFile).not.toHaveBeenCalled()
  })

  it('refuses a dropped directory with its specific reason', () => {
    const file = new File([VALID_CSV], 'folder.csv', { type: '' })

    expect(selectDroppedImportFile({
      kind: 'file',
      getAsFile: () => file,
      webkitGetAsEntry: () => ({ isDirectory: true }),
    })).toEqual({
      status: 'refused',
      reason: 'Folders cannot be uploaded. Choose one CSV file.',
    })
  })

  it.each([
    ['accepts', new File([VALID_CSV], 'statement.csv', { type: '' }), { status: 'accepted' }],
    ['refuses', new File([VALID_CSV], 'notes.txt', { type: '' }), { status: 'refused', reason: 'Choose a CSV file.' }],
  ])('%s a dropped file without directory metadata by the file policy', (_label, file, expected) => {
    const result = selectDroppedImportFile({ kind: 'file', getAsFile: () => file })

    expect(result).toMatchObject(expected)
    if (result.status === 'accepted') expect(result.file).toBe(file)
  })
})
