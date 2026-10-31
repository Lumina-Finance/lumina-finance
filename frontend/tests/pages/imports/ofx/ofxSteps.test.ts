/**
 * Tests what the steps of the OFX import show the user from the state its workflow builds: the
 * notice for statements left out, the refusal for a statement in another currency than its account,
 * the transactions skipped with their reasons and, for several files, the file each is in, and a
 * Commit that stays off while the answers are refused. The steps are rendered on the state the workflow's own build produces
 */
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { AccountsOverview } from '@/api/accounts'
import type { Category } from '@/api/categories'
import type { Currency } from '@/api/currency'
import { OfxCurrencyMismatchNotice } from '@/pages/imports/ofx/components/OfxCurrencyMismatchNotice'
import { getOfxCurrencyMismatchError, getOfxLeftOutNotice } from '@/pages/imports/ofx/constants'
import { OFX_FORMAT } from '@/pages/imports/ofx/format'
import { OfxFilesStep, OfxPreviewStep } from '@/pages/imports/ofx/sections'
import { buildOfxImportPayload } from '@/pages/imports/ofx/utils/payload'
import { readOfxFile } from '@/pages/imports/ofx/utils/readFile'
import { combineOfxFiles } from '@/pages/imports/ofx/utils/stagedFiles'
import {
  buildInvestmentMessageSet,
  buildMessageSet,
  toOfxFile,
  wrapMessageSets,
  type FixtureStatement,
} from './utils/fixtures'

const CURRENCIES = [{ id: 'CAD', name: 'Canadian dollar', symbol: '$', minor_unit_exponent: 2 }] as Currency[]
const CHEQUING = {
  id: 'chequing',
  name: 'Chequing',
  currency: 'CAD',
  can_write: true,
  is_archived: false,
  group_id: null,
} as AccountsOverview
const CATEGORIES = [
  { id: 'misc', name: 'Miscellaneous', kind: 'expense', is_system: true, group_id: null },
  { id: 'other-income', name: 'Other Income', kind: 'income', is_system: true, group_id: null },
] as Category[]

const escapeHtml = (text: string) => text.replace(/'/g, '&#x27;')

async function readStatements(statements: FixtureStatement[], leftOut: string[] = []) {
  const markup = wrapMessageSets([...statements.map((statement) => buildMessageSet(statement, false)), ...leftOut])
  const read = await readOfxFile(toOfxFile(markup))
  if (read.status !== 'read') throw new Error(read.reason)
  return read.file
}

const CHECKING: FixtureStatement = {
  transactions: [
    { name: 'Cafe', amount: '-4.00' },
    { name: 'Broken', amount: 'n/a' },
  ],
}

describe('the files step', () => {
  async function renderFilesStep(leftOut: string[], fileNames = ['statement.ofx']) {
    const file = await readStatements([CHECKING], leftOut)
    const stagedFiles = fileNames.map((name, index) => ({
      id: String(index),
      name,
      size: 10,
      lastModified: index,
      file,
    }))
    return renderToStaticMarkup(
      createElement(OfxFilesStep, {
        format: OFX_FORMAT,
        readingChoices: null,
        stagedFiles,
        leftOutNotice: getOfxLeftOutNotice(
          combineOfxFiles(stagedFiles.map((staged) => staged.file)).leftOut,
          stagedFiles.length,
        ),
        isProcessingFile: false,
        fileIntakeError: null,
        handleOfxFileChange: async () => undefined,
        removeOfxFile: () => undefined,
        uploadBlockReason: null,
        importResult: null,
      } as unknown as Parameters<typeof OfxFilesStep>[0]),
    )
  }

  it('tells the user which statements the file holds that are not imported', async () => {
    const markup = await renderFilesStep([buildInvestmentMessageSet(2)])

    expect(markup).toContain('Statements left out')
    expect(markup).toContain(escapeHtml(getOfxLeftOutNotice({ investment: 2 }, 1) ?? ''))
    expect(markup).toContain(
      '2 investment statements in this file aren&#x27;t imported: only bank, credit card and loan statements are supported.',
    )
  })

  it('counts what every staged file leaves out, and says so of the files', async () => {
    const markup = await renderFilesStep([buildInvestmentMessageSet(1)], ['2024-01.qfx', '2024-02.qfx'])

    expect(markup).toContain(
      '2 investment statements in these files aren&#x27;t imported: only bank, credit card and loan statements are supported.',
    )
  })

  // A finished import's files are its record, and the card that starts the next import comes after them
  it('puts the upload card after the notice once the import has finished', async () => {
    const file = await readStatements([CHECKING], [buildInvestmentMessageSet(1)])
    const markup = renderToStaticMarkup(
      createElement(OfxFilesStep, {
        format: OFX_FORMAT,
        readingChoices: null,
        stagedFiles: [{ id: '1', name: 'statement.ofx', size: 10, lastModified: 1, file }],
        leftOutNotice: getOfxLeftOutNotice(file.leftOut, 1),
        isProcessingFile: false,
        fileIntakeError: null,
        handleOfxFileChange: async () => undefined,
        removeOfxFile: () => undefined,
        uploadBlockReason: null,
        importResult: {},
      } as unknown as Parameters<typeof OfxFilesStep>[0]),
    )

    expect(markup.indexOf('Statements left out')).toBeGreaterThan(-1)
    expect(markup.indexOf('Statements left out')).toBeLessThan(markup.lastIndexOf('Upload statements'))
    expect(markup).not.toContain('aria-label="Remove statement.ofx"')
  })

  it('lists each staged file with its counts, and offers to add more', async () => {
    const markup = await renderFilesStep([], ['2024-01.qfx', '2024-02.qfx'])

    expect(markup).toContain('2024-01.qfx')
    expect(markup).toContain('2024-02.qfx')
    expect(markup).toContain('2 transactions · 1 statement')
    expect(markup).toContain('Add more statements')
  })

  it('says no files are staged only while none is being read', () => {
    const render = (isProcessingFile: boolean) =>
      renderToStaticMarkup(
        createElement(OfxFilesStep, {
          format: OFX_FORMAT,
          readingChoices: null,
          stagedFiles: [],
          leftOutNotice: null,
          isProcessingFile,
          fileIntakeError: null,
          handleOfxFileChange: async () => undefined,
          removeOfxFile: () => undefined,
          uploadBlockReason: null,
          importResult: null,
        } as unknown as Parameters<typeof OfxFilesStep>[0]),
      )

    expect(render(false)).toContain('No files staged')
    expect(render(true)).toContain('Reading statements')
    expect(render(true)).not.toContain('No files staged')
  })

  it('shows no such notice for a file that holds only the statements it imports', async () => {
    expect(await renderFilesStep([])).not.toContain('Statements left out')
  })
})

describe('the account step and the preview', () => {
  async function buildState(statementCurrency: string) {
    const ofxFile = await readStatements([{ ...CHECKING, currency: statementCurrency }])
    const importBuild = buildOfxImportPayload(ofxFile, {
      accountMappings: { [ofxFile.statements[0].id]: CHEQUING.id },
      accountCreateDetails: {},
      accountById: new Map([[CHEQUING.id, CHEQUING]]),
      categories: CATEGORIES,
      currencies: CURRENCIES,
    })
    return { ofxFile, importBuild }
  }

  const renderMismatchNotice = (state: Awaited<ReturnType<typeof buildState>>) =>
    renderToStaticMarkup(createElement(OfxCurrencyMismatchNotice, { mismatches: state.importBuild.currencyMismatches }))

  function renderPreviewStep(state: Awaited<ReturnType<typeof buildState>>, fileCount = 1) {
    return renderToStaticMarkup(
      createElement(OfxPreviewStep, {
        stagedFiles: Array.from({ length: fileCount }, (_, index) => ({ id: String(index) })),
        importEstimate: { rowCount: 1, transactionEstimate: 1 },
        previewGroups: [],
        predictedSkippedRows: state.importBuild.skippedRows,
        completedImport: null,
        newAccountCount: 0,
        importBuild: state.importBuild,
        importError: null,
        importResult: null,
        canCommitImport: state.importBuild.payload !== null,
        handleCommitImport: () => undefined,
      } as unknown as Parameters<typeof OfxPreviewStep>[0]),
    )
  }

  it('lists the statement in another currency than its account, and keeps Commit off', async () => {
    const state = await buildState('USD')
    const refusal = escapeHtml(getOfxCurrencyMismatchError(state.ofxFile.statements[0].label, 'USD', 'CAD'))
    const notice = renderMismatchNotice(state)
    const preview = renderPreviewStep(state)

    expect(notice).toContain('Statements in another currency')
    expect(notice).toContain(refusal)
    expect(preview).toContain(refusal)
    expect(preview).toMatch(/<button[^>]*disabled[^>]*>(?:(?!<\/button>)[\s\S])*Commit import/)
  })

  it("lists no refusal and enables Commit when the account is in the statement's currency", async () => {
    const state = await buildState('CAD')

    expect(renderMismatchNotice(state)).toBe('')
    expect(renderPreviewStep(state)).not.toMatch(/<button[^>]*disabled[^>]*>(?:(?!<\/button>)[\s\S])*Commit import/)
  })

  it('lists the skipped transaction with its reason on the preview', async () => {
    const state = await buildState('CAD')
    const preview = renderPreviewStep(state)

    expect(preview).toContain('Broken')
    expect(preview).toContain(state.importBuild.skippedRows[0].reason)
  })

  // Dates and amounts say nothing about which of several files a row is in
  it('names the file beside each skipped transaction of several files, and names none for one file', async () => {
    const state = await buildState('CAD')
    const fileName = state.importBuild.skippedRows[0].fileName

    expect(fileName).toBe('statement.ofx')
    expect(renderPreviewStep(state, 2)).toContain(`title="${fileName}"`)
    expect(renderPreviewStep(state, 1)).not.toContain(fileName)
  })
})
