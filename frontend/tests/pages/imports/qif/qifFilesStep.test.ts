/**
 * Tests the files step of the QIF import: it names QIF files and accounts, and shows the date and
 * amount settings only once files are staged, since a QIF file has no fixed way of writing them
 */
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { OfxFilesStep } from '@/pages/imports/ofx/sections'
import { QIF_FORMAT } from '@/pages/imports/qif/format'
import { scanQifReadings } from '@/pages/imports/qif/utils/readings'
import { buildQifFile } from './utils/fixtures'

function render(isStaged: boolean) {
  const file = buildQifFile([{ postedText: '1/2/2024' }, { postedText: '3/4/2024' }])
  const readingChoices = {
    scan: scanQifReadings([file]),
    dateFormat: null,
    amountFormat: null,
    isDateAutomatic: false,
    isAmountAutomatic: true,
    isDateRequired: true,
    isAmountRequired: false,
    onDateFormatChange: () => undefined,
    onAmountFormatChange: () => undefined,
  }
  return renderToStaticMarkup(
    createElement(OfxFilesStep, {
      format: QIF_FORMAT,
      readingChoices,
      stagedFiles: isStaged ? [{ id: '1', name: 'export.qif', size: 10, lastModified: 1, file }] : [],
      leftOutNotice: null,
      fixedAccount: null,
      isProcessingFile: false,
      fileIntakeError: null,
      handleOfxFileChange: async () => undefined,
      removeOfxFile: () => undefined,
      uploadBlockReason: null,
      importResult: null,
    } as unknown as Parameters<typeof OfxFilesStep>[0]),
  )
}

describe('the QIF files step', () => {
  it('lists a staged file by its accounts and offers the date and amount settings under it', () => {
    const markup = render(true)

    expect(markup).toContain('export.qif')
    expect(markup).toContain('2 transactions · 1 account')
    expect(markup).toContain('Add more QIF files')
    expect(markup).toContain('accept=".qif"')
    expect(markup).toContain('Date format')
    expect(markup).toContain('Amount format')
  })

  // The dropdown beside each name already carries it as its own label, so a screen reader would
  // otherwise read every setting's name twice
  it('hides the name of each setting from screen readers, as the dropdown beside it carries the name', () => {
    const markup = render(true)

    expect(markup).toMatch(/<span aria-hidden="true"[^>]*>Date format<\/span>/)
    expect(markup).toMatch(/<span aria-hidden="true"[^>]*>Amount format<\/span>/)
  })

  it('offers no settings and invites an upload before any file is staged', () => {
    const markup = render(false)

    expect(markup).toContain('Upload QIF files')
    expect(markup).not.toContain('Date format')
  })
})
