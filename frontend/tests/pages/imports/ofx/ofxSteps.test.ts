/**
 * Tests what the steps of the OFX import show the user from the state its workflow builds: the
 * notice for statements left out, the refusal for a statement in another currency than its account,
 * the transactions skipped with their reasons, and a Commit that stays off while the answers are
 * refused. The steps are rendered on the state the workflow's own build produces
 */
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { AccountsOverview } from '@/api/accounts'
import type { Category } from '@/api/categories'
import type { Currency } from '@/api/currency'
import { OfxCurrencyMismatchNotice } from '@/pages/imports/ofx/components/OfxCurrencyMismatchNotice'
import { getOfxCurrencyMismatchError, getOfxLeftOutNotice } from '@/pages/imports/ofx/constants'
import { OfxFilesStep, OfxPreviewStep } from '@/pages/imports/ofx/sections'
import { buildOfxImportPayload } from '@/pages/imports/ofx/utils/payload'
import { readOfxFile } from '@/pages/imports/ofx/utils/readFile'
import { buildLeftOutMessageSet, buildMessageSet, toOfxFile, wrapMessageSets, type FixtureStatement } from './utils/fixtures'

const CURRENCIES = [{ id: 'CAD', name: 'Canadian dollar', symbol: '$', minor_unit_exponent: 2 }] as Currency[]
const CHEQUING = { id: 'chequing', name: 'Chequing', currency: 'CAD', can_write: true, is_archived: false, group_id: null } as AccountsOverview
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

const CHECKING: FixtureStatement = { transactions: [{ name: 'Cafe', amount: '-4.00' }, { name: 'Broken', amount: 'n/a' }] }

describe('the files step', () => {
  async function renderFilesStep(leftOut: string[]) {
    const ofxFile = await readStatements([CHECKING], leftOut)
    return renderToStaticMarkup(createElement(OfxFilesStep, {
      stagedFile: { id: '1', name: 'statement.ofx', size: 10, statementCount: 1, transactionCount: 2 },
      ofxFile,
      isProcessingFile: false,
      fileIntakeError: null,
      handleOfxFileChange: async () => undefined,
      removeOfxFile: () => undefined,
      uploadBlockReason: null,
    } as unknown as Parameters<typeof OfxFilesStep>[0]))
  }

  it('tells the user which statements the file holds that are not imported', async () => {
    const markup = await renderFilesStep([buildLeftOutMessageSet('INVSTMTMSGSRSV1', 2), buildLeftOutMessageSet('LOANMSGSRSV1', 1)])

    expect(markup).toContain('Statements left out')
    expect(markup).toContain(escapeHtml(getOfxLeftOutNotice({ investment: 2, loan: 1 }) ?? ''))
    expect(markup).toContain('2 investment statements and 1 loan statement in this file aren&#x27;t imported.')
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

  const renderMismatchNotice = (state: Awaited<ReturnType<typeof buildState>>) => (
    renderToStaticMarkup(createElement(OfxCurrencyMismatchNotice, { mismatches: state.importBuild.currencyMismatches }))
  )

  function renderPreviewStep(state: Awaited<ReturnType<typeof buildState>>) {
    return renderToStaticMarkup(createElement(OfxPreviewStep, {
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
    } as unknown as Parameters<typeof OfxPreviewStep>[0]))
  }

  it('lists the statement in another currency than its account, and keeps Commit off', async () => {
    const state = await buildState('USD')
    const refusal = escapeHtml(getOfxCurrencyMismatchError(state.ofxFile.statements[0].label, 'USD', 'CAD'))
    const notice = renderMismatchNotice(state)
    const preview = renderPreviewStep(state)

    expect(notice).toContain('Statements in another currency')
    expect(notice).toContain(refusal)
    expect(preview).toContain(refusal)
    expect(preview).toMatch(/<button[^>]*disabled[^>]*>[^<]*Commit import/)
  })

  it('lists no refusal and enables Commit when the account is in the statement\'s currency', async () => {
    const state = await buildState('CAD')

    expect(renderMismatchNotice(state)).toBe('')
    expect(renderPreviewStep(state)).not.toMatch(/<button[^>]*disabled[^>]*>[^<]*Commit import/)
  })

  it('lists the skipped transaction with its reason on the preview', async () => {
    const state = await buildState('CAD')
    const preview = renderPreviewStep(state)

    expect(preview).toContain('Broken')
    expect(preview).toContain(state.importBuild.skippedRows[0].reason)
  })
})
